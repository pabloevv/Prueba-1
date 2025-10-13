const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL;
const PGSSLMODE = (process.env.PGSSLMODE || '').toLowerCase();
const STATIC_DIR = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : __dirname;
const PHOTO_MAX_DIMENSION = Number(process.env.PHOTO_MAX_DIMENSION || 720);

if (!DATABASE_URL) {
  console.error('Falta la variable de entorno DATABASE_URL en el archivo .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ...(PGSSLMODE === 'require'
    ? { ssl: { rejectUnauthorized: false } }
    : {})
});

const DEFAULT_USER_USERNAME = process.env.DEFAULT_USER_USERNAME || 'pablo1912';
const DEFAULT_USER_PASSWORD = process.env.DEFAULT_USER_PASSWORD || '1912';
const DEFAULT_USER_DISPLAY_NAME = process.env.DEFAULT_USER_DISPLAY_NAME || 'Pablo';

const DEFAULT_PLACES = [
  {
    id: 'cafe-aurora',
    name: 'Cafe Aurora',
    address: 'San Jose, CR',
    lat: 9.9339,
    lng: -84.0833,
    photo: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?q=80&w=1200&auto=format&fit=crop'
  },
  {
    id: 'parque-sabana',
    name: 'Parque La Sabana',
    address: 'San Jose, CR',
    lat: 9.938,
    lng: -84.1008,
    photo: 'https://images.unsplash.com/photo-1558981359-219d6364c9b8?q=80&w=1200&auto=format&fit=crop'
  },
  {
    id: 'mercado-central',
    name: 'Mercado Central',
    address: 'San Jose, CR',
    lat: 9.9343,
    lng: -84.0818,
    photo: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?q=80&w=1200&auto=format&fit=crop'
  }
];

const DEFAULT_REVIEWS = [
  {
    placeId: 'cafe-aurora',
    authorName: 'Usuario Demo',
    rating: 5,
    note: 'Capuchino cremoso y terraza con sombra. Ideal para estudiar.',
    tags: ['cafe', 'wifi', 'brunch'],
    upvotes: 3,
    downvotes: 0,
    photo: '',
    city: 'San Jose, CR',
    lat: 9.9339,
    lng: -84.0833,
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000)
  },
  {
    placeId: 'parque-sabana',
    authorName: 'Maria',
    rating: 4,
    note: 'Buen lugar para correr al atardecer. Llevar repelente para mosquitos.',
    tags: ['aire libre', 'running'],
    upvotes: 2,
    downvotes: 1,
    photo: '',
    city: 'San Jose, CR',
    lat: 9.938,
    lng: -84.1008,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000)
  },
  {
    placeId: 'mercado-central',
    authorName: 'Luis',
    rating: 5,
    note: 'Sodas tipicas ricas y baratas. Prueba el casado.',
    tags: ['comida tipica', 'barato'],
    upvotes: 5,
    downvotes: 0,
    photo: '',
    city: 'San Jose, CR',
    lat: 9.9343,
    lng: -84.0818,
    createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000)
  }
];

const app = express();

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const corsOptions =
  allowedOrigins.length > 0
    ? { origin: allowedOrigins, credentials: true }
    : { origin: true, credentials: true };

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const DATA_URL_REGEX = /^data:(image\/[a-z0-9+.\-]+);base64,(.+)$/i;

async function optimiseImageDataUrl(dataUrl) {
  const match = DATA_URL_REGEX.exec(dataUrl);
  if (!match) {
    return dataUrl;
  }

  const [, mimeType, base64Payload] = match;
  const inputBuffer = Buffer.from(base64Payload, 'base64');

  const image = sharp(inputBuffer, { limitInputPixels: false });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    return dataUrl;
  }

  let pipeline = image.rotate();

  if (metadata.width > PHOTO_MAX_DIMENSION || metadata.height > PHOTO_MAX_DIMENSION) {
    pipeline = pipeline.resize({
      width: PHOTO_MAX_DIMENSION,
      height: PHOTO_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  const lowerMime = (mimeType || '').toLowerCase();
  let outputBuffer;
  let outputMime = lowerMime;

  if (metadata.hasAlpha) {
    outputBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    outputMime = 'image/png';
  } else if (lowerMime === 'image/webp') {
    outputBuffer = await pipeline.webp({ quality: 80 }).toBuffer();
    outputMime = 'image/webp';
  } else if (lowerMime === 'image/avif') {
    outputBuffer = await pipeline.avif({ quality: 50 }).toBuffer();
    outputMime = 'image/avif';
  } else {
    outputBuffer = await pipeline.jpeg({ quality: 82, chromaSubsampling: '4:4:4' }).toBuffer();
    outputMime = 'image/jpeg';
  }

  if (outputBuffer.length >= inputBuffer.length) {
    // No ganancia; conserva original.
    return dataUrl;
  }

  return `data:${outputMime};base64,${outputBuffer.toString('base64')}`;
}

async function processPhotoValue(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  try {
    return await optimiseImageDataUrl(trimmed);
  } catch (error) {
    console.warn('No se pudo optimizar la imagen recibida:', error);
    return trimmed;
  }
}

function mapPlaceRow(row) {
  if (!row) return null;
  const lat = toNumber(row.latitude);
  const lng = toNumber(row.longitude);
  return {
    id: row.id,
    name: row.name,
    address: row.address || '',
    photo: row.photo || '',
    coords: lat !== null && lng !== null ? { lat, lng } : null
  };
}

function mapReviewRow(row) {
  if (!row) return null;
  const reviewLat = toNumber(row.latitude);
  const reviewLng = toNumber(row.longitude);
  const placeLat = toNumber(row.place_latitude);
  const placeLng = toNumber(row.place_longitude);
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.getTime()
      : row.created_at
      ? Date.parse(row.created_at)
      : Date.now();
  const tags = Array.isArray(row.tags)
    ? row.tags.filter(tag => typeof tag === 'string')
    : [];

  return {
    id: row.id,
    placeId: row.place_id,
    city: row.city || row.place_address || '',
    rating: Number(row.rating) || 0,
    photo: row.photo || row.place_photo || '',
    note: row.note || '',
    tags,
    userId: row.user_id !== null && row.user_id !== undefined ? Number(row.user_id) : null,
    userName: row.author_name || '',
    up: Number(row.upvotes) || 0,
    down: Number(row.downvotes) || 0,
    createdAt,
    coords:
      reviewLat !== null && reviewLng !== null
        ? { lat: reviewLat, lng: reviewLng }
        : placeLat !== null && placeLng !== null
        ? { lat: placeLat, lng: placeLng }
        : null
  };
}

async function ensureUpdatedAtTrigger(tableName) {
  const functionName = `${tableName}_set_updated_at`;
  const triggerName = `trg_${tableName}_set_updated_at`;

  await pool.query(`
    CREATE OR REPLACE FUNCTION ${functionName}()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName}`);
  await pool.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE UPDATE ON ${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION ${functionName}();
  `);
}

async function ensureCoreTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await ensureUpdatedAtTrigger('app_users');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      photo TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await ensureUpdatedAtTrigger('places');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id BIGSERIAL PRIMARY KEY,
      place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      note TEXT,
      photo TEXT,
      tags TEXT[] NOT NULL DEFAULT '{}',
      upvotes INTEGER NOT NULL DEFAULT 0,
      downvotes INTEGER NOT NULL DEFAULT 0,
      city TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await ensureUpdatedAtTrigger('reviews');

  const passwordHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 10);

  await pool.query(
    `
      INSERT INTO app_users (username, display_name, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (username) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          password_hash = EXCLUDED.password_hash
    `,
    [DEFAULT_USER_USERNAME, DEFAULT_USER_DISPLAY_NAME, passwordHash]
  );

  for (const place of DEFAULT_PLACES) {
    await pool.query(
      `
        INSERT INTO places (id, name, address, photo, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            address = EXCLUDED.address,
            photo = EXCLUDED.photo,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            updated_at = now()
      `,
      [
        place.id,
        place.name,
        place.address || '',
        place.photo || null,
        place.lat,
        place.lng
      ]
    );
  }

  const { rows: reviewCountRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM reviews'
  );
  if ((reviewCountRows[0]?.count || 0) === 0) {
    for (const review of DEFAULT_REVIEWS) {
      await pool.query(
        `
          INSERT INTO reviews (
            place_id,
            user_id,
            author_name,
            rating,
            note,
            photo,
            tags,
            upvotes,
            downvotes,
            city,
            latitude,
            longitude,
            created_at,
            updated_at
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
        `,
        [
          review.placeId,
          review.authorName,
          review.rating,
          review.note || '',
          review.photo || null,
          review.tags,
          review.upvotes,
          review.downvotes,
          review.city || '',
          review.lat,
          review.lng,
          review.createdAt
        ]
      );
    }
  }
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contrasena son obligatorios.' });
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT id, username, display_name, password_hash
        FROM app_users
        WHERE username = $1
      `,
      [username]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Credenciales invalidas.' });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Credenciales invalidas.' });
    }

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name
      }
    });
  } catch (error) {
    console.error('Error en /api/login:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ ok: false, error: 'database_unreachable' });
  }
});

app.get('/api/places', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, address, photo, latitude, longitude FROM places ORDER BY name ASC'
    );
    res.json({
      places: rows.map(mapPlaceRow)
    });
  } catch (error) {
    console.error('Error al listar lugares:', error);
    res.status(500).json({ error: 'No se pudieron obtener los lugares.' });
  }
});

app.get('/api/nearby-geojson', async (req, res) => {
  const lat = toNumber(req.query.lat);
  const lng = toNumber(req.query.lng);
  const radius = toNumber(req.query.radius);
  const limit = toNumber(req.query.limit);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Los parámetros lat y lng son obligatorios.' });
  }

  const radiusMeters =
    Number.isFinite(radius) && radius > 0 ? radius : 3000;
  const limitRows =
    limit && limit > 0 ? Math.min(Math.max(Math.floor(limit), 1), 200) : 50;

  try {
    const { rows } = await pool.query(
      `
        WITH target AS (
          SELECT
            ST_SetSRID(ST_MakePoint($2, $1), 4326) AS geom,
            NULLIF($3::double precision, 0) AS max_distance
        ),
        ranked AS (
          SELECT
            p.id,
            p.name,
            p.address,
            p.photo,
            p.latitude,
            p.longitude,
            dist.distance
          FROM places p
          CROSS JOIN target
          CROSS JOIN LATERAL (
            SELECT ST_DistanceSphere(
              ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326),
              target.geom
            ) AS distance
          ) dist
          WHERE p.latitude IS NOT NULL
            AND p.longitude IS NOT NULL
            AND (
              target.max_distance IS NULL
              OR dist.distance <= target.max_distance
            )
          ORDER BY dist.distance ASC
          LIMIT $4
        )
        SELECT json_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326))::json,
              'properties', json_build_object(
                'id', r.id,
                'name', r.name,
                'address', r.address,
                'photo', r.photo,
                'latitude', r.latitude,
                'longitude', r.longitude,
                'distance', r.distance
              )
            )
          ), '[]'::json)
        ) AS fc
        FROM ranked r;
      `,
      [lat, lng, radiusMeters, limitRows]
    );

    return res.json(rows?.[0]?.fc ?? { type: 'FeatureCollection', features: [] });
  } catch (error) {
    console.error('Error al consultar lugares cercanos:', error);
    return res.status(500).json({ error: 'No se pudieron obtener los lugares cercanos.' });
  }
});

app.get('/api/reviews', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT
          r.*,
          p.name AS place_name,
          p.address AS place_address,
          p.photo AS place_photo,
          p.latitude AS place_latitude,
          p.longitude AS place_longitude
        FROM reviews r
        JOIN places p ON p.id = r.place_id
        ORDER BY r.created_at DESC
      `
    );
    res.json({
      reviews: rows.map(mapReviewRow)
    });
  } catch (error) {
    console.error('Error al listar reseñas:', error);
    res.status(500).json({ error: 'No se pudieron obtener las reseñas.' });
  }
});

app.post('/api/places', async (req, res) => {
  const payload = req.body || {};
  const rawId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const placeId = rawId || crypto.randomUUID();
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const address =
    typeof payload.address === 'string'
      ? payload.address.trim()
      : typeof payload.city === 'string'
      ? payload.city.trim()
      : '';
  const photo =
    typeof payload.photo === 'string'
      ? payload.photo.trim()
      : typeof payload.photo_url === 'string'
      ? payload.photo_url.trim()
      : null;
  const processedPhoto = await processPhotoValue(photo);
  const latitude = toNumber(payload.latitude ?? payload.lat);
  const longitude = toNumber(payload.longitude ?? payload.lng);

  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({
      error: 'Nombre, latitud y longitud son obligatorios.'
    });
  }

  try {
    const { rows } = await pool.query(
      `
        INSERT INTO places (id, name, address, photo, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            address = EXCLUDED.address,
            photo = COALESCE(EXCLUDED.photo, places.photo),
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            updated_at = now()
        RETURNING id, name, address, photo, latitude, longitude
      `,
      [placeId, name, address, processedPhoto || null, latitude, longitude]
    );

    return res.status(201).json({ place: mapPlaceRow(rows[0]) });
  } catch (error) {
    console.error('Error al crear el lugar:', error);
    return res.status(500).json({ error: 'No se pudo registrar el lugar.' });
  }
});

app.post('/api/reviews', async (req, res) => {
  const { place, review, userId } = req.body || {};

  if (!userId) {
    return res.status(400).json({ error: 'Falta el identificador del usuario.' });
  }

  const userIdNumber = Number(userId);
  if (!Number.isInteger(userIdNumber)) {
    return res.status(400).json({ error: 'El identificador del usuario no es valido.' });
  }

  const placeData = place || {};
  const reviewData = review || {};

  const [placePhoto, reviewPhoto] = await Promise.all([
    processPhotoValue(placeData.photo),
    processPhotoValue(reviewData.photo)
  ]);

  if (!placeData.id || !placeData.name) {
    return res.status(400).json({ error: 'Faltan datos del lugar.' });
  }

  const rating = Number(reviewData.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'La calificacion debe estar entre 1 y 5.' });
  }

  const tags = Array.isArray(reviewData.tags)
    ? reviewData.tags
        .map(tag => String(tag).trim())
        .filter(Boolean)
    : [];

  const coordsLat =
    placeData.coords && typeof placeData.coords.lat === 'number'
      ? placeData.coords.lat
      : null;
  const coordsLng =
    placeData.coords && typeof placeData.coords.lng === 'number'
      ? placeData.coords.lng
      : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      'SELECT id, display_name FROM app_users WHERE id = $1',
      [userIdNumber]
    );
    if (!userRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const authorName = userRows[0].display_name || '';

    await client.query(
      `
        INSERT INTO places (id, name, address, photo, latitude, longitude)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            address = EXCLUDED.address,
            photo = COALESCE(EXCLUDED.photo, places.photo),
            latitude = COALESCE(EXCLUDED.latitude, places.latitude),
            longitude = COALESCE(EXCLUDED.longitude, places.longitude),
            updated_at = now()
      `,
      [
        placeData.id,
        placeData.name,
        placeData.address || '',
        placePhoto || null,
        coordsLat,
        coordsLng
      ]
    );

    const { rows: reviewRows } = await client.query(
      `
        INSERT INTO reviews (
          place_id,
          user_id,
          author_name,
          rating,
          note,
          photo,
          tags,
          city,
          latitude,
          longitude
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        placeData.id,
        userIdNumber,
        authorName || placeData.name || 'Autor',
        rating,
        reviewData.note || '',
        reviewPhoto || null,
        tags,
        reviewData.city || placeData.address || '',
        coordsLat,
        coordsLng
      ]
    );

    await client.query('COMMIT');

    const createdReview = reviewRows[0];
    const { rows: placeRows } = await pool.query(
      'SELECT id, name, address, photo, latitude, longitude FROM places WHERE id = $1',
      [placeData.id]
    );
    const placeRow = placeRows[0];

    return res.status(201).json({
      review: mapReviewRow({
        ...createdReview,
        place_address: placeRow?.address,
        place_photo: placeRow?.photo,
        place_latitude: placeRow?.latitude,
        place_longitude: placeRow?.longitude
      }),
      place: placeRow ? mapPlaceRow(placeRow) : null
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error al crear la reseña:', error);
    return res.status(500).json({ error: 'No se pudo guardar la reseña.' });
  } finally {
    client.release();
  }
});

app.post('/api/reviews/:id/vote', async (req, res) => {
  const reviewId = Number(req.params.id);
  if (!Number.isInteger(reviewId)) {
    return res.status(400).json({ error: 'Identificador de reseña invalido.' });
  }

  const delta = Number(req.body?.delta);
  if (delta !== 1 && delta !== -1) {
    return res.status(400).json({ error: 'El voto debe ser 1 o -1.' });
  }

  const column = delta > 0 ? 'upvotes' : 'downvotes';

  try {
    const { rows } = await pool.query(
      `
        UPDATE reviews
        SET ${column} = ${column} + 1,
            updated_at = now()
        WHERE id = $1
        RETURNING id, upvotes, downvotes
      `,
      [reviewId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Reseña no encontrada.' });
    }

    return res.json({
      reviewId,
      up: Number(rows[0].upvotes) || 0,
      down: Number(rows[0].downvotes) || 0
    });
  } catch (error) {
    console.error('Error al registrar el voto:', error);
    return res.status(500).json({ error: 'No se pudo registrar el voto.' });
  }
});

app.use(express.static(STATIC_DIR));

app.use((req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }
  const requested = req.path;
  if (requested.startsWith('/api') || requested === '/health') {
    return next();
  }
  return res.sendFile(path.join(STATIC_DIR, 'BETA.html'), error => {
    if (error) {
      next();
    }
  });
});

ensureCoreTables()
  .then(() => {
    app.listen(PORT, HOST, () => {
      const localUrl = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
      console.log(`API y frontend disponibles en ${localUrl}`);
      if (HOST === '0.0.0.0') {
        console.log('Para otra máquina es http://100.117.52.45:3000');
      }
    });
  })
  .catch(error => {
    console.error('No se pudo inicializar la base de datos:', error);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
