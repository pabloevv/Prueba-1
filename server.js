const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const firebaseAdmin = require('firebase-admin');
const { MongoClient, ObjectId } = require('mongodb');

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_STATIC_DIR = path.join(__dirname, 'frontend', 'dist');
const STATIC_DIR = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : DEFAULT_STATIC_DIR;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'luggo';

if (!MONGODB_URI) {
  console.error('Falta la variable de entorno MONGODB_URI en el archivo .env');
  process.exit(1);
}

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
let firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;

if (firebasePrivateKey) {
  firebasePrivateKey = firebasePrivateKey.replace(/\\n/g, '\n');
}

if (!firebaseProjectId || !firebaseClientEmail || !firebasePrivateKey) {
  console.error(
    [
      'Faltan variables de entorno de Firebase.',
      'AsegÃºrate de definir FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY.'
    ].join(' ')
  );
  process.exit(1);
}

if (!firebaseAdmin.apps.length) {
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert({
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined
  });
}

const mongoClient = new MongoClient(MONGODB_URI, {
  ignoreUndefined: true,
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000
});

let mongoDb = null;
const collectionsCache = new Map();

function getCollection(name) {
  if (!mongoDb) {
    throw new Error('MongoDB no se ha inicializado todavÃ­a.');
  }
  if (!collectionsCache.has(name)) {
    collectionsCache.set(name, mongoDb.collection(name));
  }
  return collectionsCache.get(name);
}

const DEFAULT_PLACES = [
  {
    id: 'cafe-aurora',
    name: 'Cafe Aurora',
    address: 'San Jose, CR',
    lat: 9.9339,
    lng: -84.0833,
    photo:
      'https://images.unsplash.com/photo-1541167760496-1628856ab772?q=80&w=1200&auto=format&fit=crop'
  },
  {
    id: 'parque-sabana',
    name: 'Parque La Sabana',
    address: 'San Jose, CR',
    lat: 9.938,
    lng: -84.1008,
    photo:
      'https://images.unsplash.com/photo-1558981359-219d6364c9b8?q=80&w=1200&auto=format&fit=crop'
  },
  {
    id: 'mercado-central',
    name: 'Mercado Central',
    address: 'San Jose, CR',
    lat: 9.9343,
    lng: -84.0818,
    photo:
      'https://images.unsplash.com/photo-1542831371-29b0f74f9713?q=80&w=1200&auto=format&fit=crop'
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
app.use(express.json({ limit: '2mb' }));

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function mapImageDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    url: doc.url,
    provider: doc.provider || 'fb',
    width: typeof doc.width === 'number' ? doc.width : null,
    height: typeof doc.height === 'number' ? doc.height : null,
    size: typeof doc.size === 'number' ? doc.size : null,
    thumbnail: doc.thumbnailUrl || null
  };
}

function mapPlaceDoc(doc) {
  if (!doc) return null;
  const hasCoords =
    doc.coords &&
    typeof doc.coords.lat === 'number' &&
    typeof doc.coords.lng === 'number';
  return {
    id: doc._id,
    name: doc.name,
    address: doc.address || '',
    photo: doc.photoUrl || '',
    coords: hasCoords ? { lat: doc.coords.lat, lng: doc.coords.lng } : null
  };
}

function mapUserDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id ? doc._id.toString() : null,
    uid: doc.uid,
    displayName: doc.displayName || doc.email || 'Visitante',
    photoURL: doc.photoURL || null,
    email: doc.email || null,
    role: doc.role || 'usr'
  };
}

function mapReviewDoc(doc, placeDoc, userDoc, imageDocs, myVote = 0) {
  if (!doc) return null;
  const coords =
    doc.coords &&
    typeof doc.coords.lat === 'number' &&
    typeof doc.coords.lng === 'number'
      ? { lat: doc.coords.lat, lng: doc.coords.lng }
      : placeDoc?.coords &&
        typeof placeDoc.coords.lat === 'number' &&
        typeof placeDoc.coords.lng === 'number'
      ? { lat: placeDoc.coords.lat, lng: placeDoc.coords.lng }
      : null;

  const createdAt =
    doc.createdAt instanceof Date
      ? doc.createdAt.getTime()
      : doc.createdAt
      ? Date.parse(doc.createdAt)
      : Date.now();

  const tags = Array.isArray(doc.tags)
    ? doc.tags.filter(tag => typeof tag === 'string')
    : [];

  const imagePayload = Array.isArray(imageDocs)
    ? imageDocs.map(mapImageDoc).filter(Boolean)
    : [];

  const primaryImage = imagePayload.find(image => image?.url);

  const resolvedPhoto =
    doc.photoUrl ||
    primaryImage?.url ||
    placeDoc?.photo ||
    doc.photo ||
    '';

  return {
    id: doc._id.toString(),
    placeId: doc.placeId,
    city: doc.city || placeDoc?.address || '',
    rating: Number(doc.rating) || 0,
    photo: resolvedPhoto,
    note: doc.note || '',
    tags,
    userId: userDoc?._id ? userDoc._id.toString() : null,
    userUid: doc.uid || null,
    userName: doc.authorName || userDoc?.displayName || '',
    up: Number(doc.upvotes) || 0,
    down: Number(doc.downvotes) || 0,
    createdAt,
    coords,
    images: imagePayload,
    myVote: Number.isInteger(myVote) ? myVote : 0
  };
}

async function ensureUserDocument(decodedToken) {
  const users = getCollection('users');
  const now = new Date();
  const profile = {
    uid: decodedToken.uid,
    email: decodedToken.email || null,
    displayName: decodedToken.name || decodedToken.email || 'Visitante',
    photoURL: decodedToken.picture || null,
    provider: decodedToken.firebase?.sign_in_provider || null,
    updatedAt: now
  };

  const { value } = await users.findOneAndUpdate(
    { uid: decodedToken.uid },
    {
      $set: profile,
      $setOnInsert: {
        role: 'usr',
        createdAt: now
      }
    },
    {
      upsert: true,
      returnDocument: 'after'
    }
  );

  return value;
}

async function optionalAuth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  if (!token) {
    return null;
  }
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    const users = getCollection('users');
    const userDoc = await users.findOne({ uid: decoded.uid });
    return { decoded, userDoc };
  } catch (error) {
    console.warn('Token de Firebase invÃ¡lido (ignorado):', error.message);
    return null;
  }
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const token = header.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    req.auth = decoded;
    req.userDoc = await ensureUserDocument(decoded);
    return next();
  } catch (error) {
    console.error('Error en autenticaciÃ³n:', error);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

async function ensureIndexesAndSeed() {
  const users = getCollection('users');
  const places = getCollection('places');
  const reviews = getCollection('reviews');
  const images = getCollection('images');
  const votes = getCollection('review_votes');

  await Promise.all([
    users.createIndex({ uid: 1 }, { unique: true }),
    places.createIndex({ name: 1 }),
    places.createIndex({ location: '2dsphere' }),
    reviews.createIndex({ placeId: 1, createdAt: -1 }),
    reviews.createIndex({ uid: 1, createdAt: -1 }),
    images.createIndex({ uid: 1, createdAt: -1 }),
    votes.createIndex({ reviewId: 1, uid: 1 }, { unique: true })
  ]);

  const placeCount = await places.estimatedDocumentCount();
  if (placeCount === 0) {
    const now = new Date();
    await places.insertMany(
      DEFAULT_PLACES.map(place => ({
        _id: place.id,
        name: place.name,
        address: place.address || '',
        photoUrl: place.photo || '',
        coords:
          typeof place.lat === 'number' && typeof place.lng === 'number'
            ? { lat: place.lat, lng: place.lng }
            : null,
        location:
          typeof place.lat === 'number' && typeof place.lng === 'number'
            ? { type: 'Point', coordinates: [place.lng, place.lat] }
            : null,
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  const reviewCount = await reviews.estimatedDocumentCount();
  if (reviewCount === 0) {
    const now = new Date();
    await reviews.insertMany(
      DEFAULT_REVIEWS.map(review => ({
        placeId: review.placeId,
        uid: null,
        authorName: review.authorName,
        rating: review.rating,
        note: review.note || '',
        tags: review.tags || [],
        city: review.city || '',
        coords:
          typeof review.lat === 'number' && typeof review.lng === 'number'
            ? { lat: review.lat, lng: review.lng }
            : null,
        imageIds: [],
        photoUrl: review.photo || '',
        upvotes: review.upvotes || 0,
        downvotes: review.downvotes || 0,
        createdAt: review.createdAt || now,
        updatedAt: now
      }))
    );
  }
}

function parseObjectId(value) {
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
}

app.get('/health', async (_req, res) => {
  try {
    await mongoDb.command({ ping: 1 });
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await mongoDb.command({ ping: 1 });
    res.json({ ok: true });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ ok: false, error: 'database_unreachable' });
  }
});

app.post('/api/auth/session', requireAuth, async (req, res) => {
  try {
    const reviews = getCollection('reviews');
    const reviewCount = await reviews.countDocuments({ uid: req.auth.uid });
    const user = mapUserDoc(req.userDoc);
    res.json({
      user: {
        ...user,
        stats: {
          reviews: reviewCount
        }
      }
    });
  } catch (error) {
    console.error('Error en /api/auth/session:', error);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/images', requireAuth, async (req, res) => {
  const payload = req.body || {};
  const rawUrl =
    typeof payload.u === 'string'
      ? payload.u
      : typeof payload.url === 'string'
      ? payload.url
      : '';
  const url = rawUrl.trim();
  if (!url) {
    return res.status(400).json({ error: 'image_url_required' });
  }

  const width = toNumber(payload.w ?? payload.width);
  const height = toNumber(payload.h ?? payload.height);
  const size = toNumber(payload.s ?? payload.size);
  const provider =
    typeof payload.pv === 'string'
      ? payload.pv
      : typeof payload.provider === 'string'
      ? payload.provider
      : 'fb';

  const imageDoc = {
    url,
    provider,
    width: width ?? undefined,
    height: height ?? undefined,
    size: size ?? undefined,
    thumbnailUrl:
      typeof payload.thumb === 'string'
        ? payload.thumb.trim()
        : typeof payload.thumbnailUrl === 'string'
        ? payload.thumbnailUrl.trim()
        : undefined,
    uid: req.auth.uid,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  try {
    const images = getCollection('images');
    const { insertedId } = await images.insertOne(imageDoc);
    const inserted = await images.findOne({ _id: insertedId });
    res.status(201).json({ image: mapImageDoc(inserted) });
  } catch (error) {
    console.error('Error al registrar metadata de imagen:', error);
    res.status(500).json({ error: 'no_se_guardaron_los_metadatos' });
  }
});

app.get('/api/places', async (_req, res) => {
  try {
    const places = getCollection('places');
    const docs = await places.find().sort({ name: 1 }).toArray();
    res.json({ places: docs.map(mapPlaceDoc) });
  } catch (error) {
    console.error('Error al listar lugares:', error);
    res.status(500).json({ error: 'no_se_pudieron_obtener_los_lugares' });
  }
});

app.post('/api/places', requireAuth, async (req, res) => {
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

  const photoUrl =
    typeof payload.photo === 'string'
      ? payload.photo.trim()
      : typeof payload.photoUrl === 'string'
      ? payload.photoUrl.trim()
      : '';

  const coordsObject =
    payload.coords &&
    typeof payload.coords.lat === 'number' &&
    typeof payload.coords.lng === 'number'
      ? payload.coords
      : {
          lat: toNumber(payload.lat),
          lng: toNumber(payload.lng)
        };

  if (!name || !coordsObject || !Number.isFinite(coordsObject.lat) || !Number.isFinite(coordsObject.lng)) {
    return res.status(400).json({ error: 'nombre_y_coordenadas_requeridos' });
  }

  try {
    const places = getCollection('places');
    const now = new Date();
    const update = {
      name,
      address,
      photoUrl,
      coords: { lat: coordsObject.lat, lng: coordsObject.lng },
      location: {
        type: 'Point',
        coordinates: [coordsObject.lng, coordsObject.lat]
      },
      updatedAt: now
    };

    const { value } = await places.findOneAndUpdate(
      { _id: placeId },
      { $set: update, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' }
    );

    res.status(201).json({ place: mapPlaceDoc(value) });
  } catch (error) {
    console.error('Error al crear/actualizar el lugar:', error);
    res.status(500).json({ error: 'no_se_pudo_guardar_el_lugar' });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const auth = await optionalAuth(req);
    const uid = auth?.decoded?.uid || null;

    const reviewsCollection = getCollection('reviews');
    const pipeline = [
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
      {
        $lookup: {
          from: 'places',
          localField: 'placeId',
          foreignField: '_id',
          as: 'place'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'uid',
          foreignField: 'uid',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'images',
          localField: 'imageIds',
          foreignField: '_id',
          as: 'images'
        }
      }
    ];

    const docs = await reviewsCollection.aggregate(pipeline).toArray();
    const reviewIds = docs.map(doc => doc._id);

    const votesByReview = new Map();
    if (uid && reviewIds.length > 0) {
      const votes = await getCollection('review_votes')
        .find({ uid, reviewId: { $in: reviewIds } })
        .toArray();
      votes.forEach(vote => {
        votesByReview.set(vote.reviewId.toString(), Number(vote.value) || 0);
      });
    }

    const payload = docs.map(doc => {
      const placeDoc = doc.place?.[0] || null;
      const userDoc = doc.user?.[0] || null;
      const voteValue = votesByReview.get(doc._id.toString()) ?? 0;
      return mapReviewDoc(doc, placeDoc ? mapPlaceDoc(placeDoc) : null, userDoc, doc.images, voteValue);
    });

    res.json({ reviews: payload });
  } catch (error) {
    console.error('Error al listar reseÃ±as:', error);
    res.status(500).json({ error: 'no_se_pudieron_obtener_las_resenas' });
  }
});

app.post('/api/reviews', requireAuth, async (req, res) => {
  const body = req.body || {};
  const placePayload = body.place || {};
  const placeId =
    typeof placePayload.id === 'string'
      ? placePayload.id.trim()
      : typeof body.placeId === 'string'
      ? body.placeId.trim()
      : typeof body.pl === 'string'
      ? body.pl.trim()
      : '';

  if (!placeId) {
    return res.status(400).json({ error: 'place_id_required' });
  }

  const rating = toNumber(body.rating ?? body.rt);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating_invalid' });
  }

  const note =
    typeof body.note === 'string'
      ? body.note.trim()
      : typeof body.tx === 'string'
      ? body.tx.trim()
      : '';

  const tags = Array.isArray(body.tags)
    ? body.tags.map(tag => String(tag).trim()).filter(Boolean)
    : Array.isArray(body.tg)
    ? body.tg.map(tag => String(tag).trim()).filter(Boolean)
    : [];

  const imageIdsInput =
    Array.isArray(body.images) && body.images.length
      ? body.images
      : Array.isArray(body.imageIds) && body.imageIds.length
      ? body.imageIds
      : Array.isArray(body.im)
      ? body.im
      : [];

  const imageObjectIds = imageIdsInput
    .map(id => (typeof id === 'string' ? parseObjectId(id) : null))
    .filter(Boolean);

  const places = getCollection('places');
  const reviews = getCollection('reviews');
  const images = getCollection('images');

  try {
    const now = new Date();
    let placeDoc = await places.findOne({ _id: placeId });

    const coords =
      placePayload.coords &&
      typeof placePayload.coords.lat === 'number' &&
      typeof placePayload.coords.lng === 'number'
        ? placePayload.coords
        : {
            lat: toNumber(placePayload.lat),
            lng: toNumber(placePayload.lng)
          };

    if (!placeDoc) {
      if (!placePayload.name || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
        return res.status(400).json({ error: 'place_data_incomplete' });
      }
      const newPlace = {
        _id: placeId,
        name: placePayload.name,
        address: placePayload.address || body.city || '',
        photoUrl: placePayload.photo || '',
        coords: { lat: coords.lat, lng: coords.lng },
        location: { type: 'Point', coordinates: [coords.lng, coords.lat] },
        createdAt: now,
        updatedAt: now
      };
      await places.insertOne(newPlace);
      placeDoc = newPlace;
    } else {
      const update = {
        updatedAt: now
      };

      if (placePayload.name && placePayload.name !== placeDoc.name) {
        update.name = placePayload.name;
      }
      if (placePayload.address && placePayload.address !== placeDoc.address) {
        update.address = placePayload.address;
      }
      if (placePayload.photo) {
        update.photoUrl = placePayload.photo;
      }
      if (Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        update.coords = { lat: coords.lat, lng: coords.lng };
        update.location = { type: 'Point', coordinates: [coords.lng, coords.lat] };
      }
      if (Object.keys(update).length > 1) {
        await places.updateOne({ _id: placeId }, { $set: update });
        placeDoc = await places.findOne({ _id: placeId });
      }
    }

    let linkedImages = [];
    if (imageObjectIds.length > 0) {
      linkedImages = await images
        .find({ _id: { $in: imageObjectIds }, uid: req.auth.uid })
        .toArray();
    }

    const reviewDoc = {
      placeId,
      uid: req.auth.uid,
      authorName: req.userDoc?.displayName || req.auth.name || 'Visitante',
      rating,
      note,
      tags,
      city: body.city || placePayload.address || placeDoc?.address || '',
      coords:
        Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
          ? { lat: coords.lat, lng: coords.lng }
          : placeDoc?.coords || null,
      imageIds: linkedImages.map(image => image._id),
      photoUrl: body.photo || placePayload.photo || '',
      upvotes: 0,
      downvotes: 0,
      createdAt: now,
      updatedAt: now
    };

    const { insertedId } = await reviews.insertOne(reviewDoc);

    const inserted = await reviews.findOne({ _id: insertedId });
    const responsePlace = placeDoc ? mapPlaceDoc(placeDoc) : null;
    const mappedReview = mapReviewDoc(inserted, responsePlace, req.userDoc, linkedImages, 0);

    res.status(201).json({
      review: mappedReview,
      place: responsePlace
    });
  } catch (error) {
    console.error('Error al crear la reseÃ±a:', error);
    res.status(500).json({ error: 'no_se_pudo_guardar_la_resena' });
  }
});

app.post('/api/reviews/:id/vote', requireAuth, async (req, res) => {
  const reviewId = parseObjectId(req.params.id);
  if (!reviewId) {
    return res.status(400).json({ error: 'invalid_review_id' });
  }

  const value = toNumber(req.body?.value ?? req.body?.delta);
  if (![1, 0, -1].includes(value)) {
    return res.status(400).json({ error: 'invalid_vote_value' });
  }

  try {
    const votes = getCollection('review_votes');
    const reviews = getCollection('reviews');
    const now = new Date();

    const existingVote = await votes.findOne({ reviewId, uid: req.auth.uid });
    if (existingVote && existingVote.value === value) {
      const reviewDoc = await reviews.findOne(
        { _id: reviewId },
        { projection: { upvotes: 1, downvotes: 1 } }
      );
      return res.json({
        reviewId: reviewId.toString(),
        up: Number(reviewDoc?.upvotes) || 0,
        down: Number(reviewDoc?.downvotes) || 0,
        my: Number(existingVote.value) || 0
      });
    }

    const inc = { upvotes: 0, downvotes: 0 };

    if (existingVote) {
      if (existingVote.value === 1) inc.upvotes -= 1;
      if (existingVote.value === -1) inc.downvotes -= 1;
    }

    if (value === 1) inc.upvotes += 1;
    if (value === -1) inc.downvotes += 1;

    if (existingVote && value === 0) {
      await votes.deleteOne({ _id: existingVote._id });
    } else if (value !== 0) {
      await votes.updateOne(
        { reviewId, uid: req.auth.uid },
        {
          $set: {
            value,
            updatedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        { upsert: true }
      );
    }

    const update = {
      $set: { updatedAt: now }
    };

    const incUpdate = {};
    if (inc.upvotes !== 0) {
      incUpdate.upvotes = inc.upvotes;
    }
    if (inc.downvotes !== 0) {
      incUpdate.downvotes = inc.downvotes;
    }
    if (Object.keys(incUpdate).length > 0) {
      update.$inc = incUpdate;
    }

    const { value: updated } = await reviews.findOneAndUpdate(
      { _id: reviewId },
      update,
      {
        returnDocument: 'after',
        projection: { upvotes: 1, downvotes: 1 }
      }
    );

    if (!updated) {
      return res.status(404).json({ error: 'review_not_found' });
    }

    res.json({
      reviewId: reviewId.toString(),
      up: Number(updated.upvotes) || 0,
      down: Number(updated.downvotes) || 0,
      my: value
    });
  } catch (error) {
    console.error('Error al registrar el voto:', error);
    res.status(500).json({ error: 'no_se_pudo_registrar_el_voto' });
  }
});

app.get('/api/nearby-geojson', async (req, res) => {
  const lat = toNumber(req.query.lat);
  const lng = toNumber(req.query.lng);
  const radius = toNumber(req.query.radius);
  const limit = toNumber(req.query.limit);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat_y_lng_requeridos' });
  }

  const radiusMeters = Number.isFinite(radius) && radius > 0 ? radius : 3000;
  const limitRows =
    limit && limit > 0 ? Math.min(Math.max(Math.floor(limit), 1), 200) : 50;

  try {
    const places = getCollection('places');
    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distance',
          maxDistance: radiusMeters,
          query: { location: { $exists: true } },
          spherical: true
        }
      },
      { $limit: limitRows },
      {
        $project: {
          _id: 1,
          name: 1,
          address: 1,
          photoUrl: 1,
          coords: 1,
          distance: 1
        }
      }
    ];

    const docs = await places.aggregate(pipeline).toArray();
    const features = docs.map(doc => {
      const coords =
        doc.coords &&
        typeof doc.coords.lat === 'number' &&
        typeof doc.coords.lng === 'number'
          ? { lat: doc.coords.lat, lng: doc.coords.lng }
          : null;
      return {
        type: 'Feature',
        geometry: coords
          ? {
              type: 'Point',
              coordinates: [coords.lng, coords.lat]
            }
          : null,
        properties: {
          id: doc._id,
          name: doc.name,
          address: doc.address || '',
          photo: doc.photoUrl || '',
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          distance: doc.distance ?? null
        }
      };
    });

    res.json({
      type: 'FeatureCollection',
      features
    });
  } catch (error) {
    console.error('Error al consultar lugares cercanos:', error);
    res.status(500).json({ error: 'no_se_pudieron_obtener_los_lugares_cercanos' });
  }
});

if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
} else {
  console.warn('Directorio estatico no encontrado:', STATIC_DIR);
}

app.use((req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }
  const requested = req.path;
  if (requested.startsWith('/api') || requested === '/health') {
    return next();
  }
  return res.sendFile(path.join(STATIC_DIR, 'index.html'), error => {
    if (error) {
      next();
    }
  });
});

async function startServer() {
  try {
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB_NAME);
    await ensureIndexesAndSeed();
    app.listen(PORT, HOST, () => {
      const localUrl = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
      console.log(`API y frontend disponibles en ${localUrl}`);
    });
  } catch (error) {
    console.error('No se pudo inicializar la aplicaciÃ³n:', error);
    process.exit(1);
  }
}

startServer();

async function gracefulShutdown() {
  try {
    await mongoClient.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);









