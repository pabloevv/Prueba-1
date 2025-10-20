/* eslint-disable no-console */
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const firebaseAdmin = require('firebase-admin');
const { MongoClient, ObjectId } = require('mongodb');

dotenv.config();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const STATIC_DIR = path.join(__dirname, 'frontend', 'dist');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'Luggov2';

if (!MONGODB_URI) {
  console.error('Falta la variable de entorno MONGODB_URI en el archivo .env');
  process.exit(1);
}

// Firebase Admin
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = resolveFirebasePrivateKey();
const firebaseStorageBucket = process.env.FIREBASE_STORAGE_BUCKET || undefined;

if (!firebaseProjectId || !firebaseClientEmail || !firebasePrivateKey) {
  console.error('Faltan variables de entorno de Firebase (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
  process.exit(1);
}

if (!firebaseAdmin.apps.length) {
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.credential.cert({
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey
    }),
    storageBucket: firebaseStorageBucket
  });
}

// MongoDB Client
const mongoClient = new MongoClient(MONGODB_URI, {
  ignoreUndefined: true,
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000
});

let mongoDb = null;
const collectionsCache = new Map();

function getCollection(name) {
  if (!mongoDb) throw new Error('MongoDB aún no está inicializado');
  if (!collectionsCache.has(name)) collectionsCache.set(name, mongoDb.collection(name));
  return collectionsCache.get(name);
}

// ---------------------------------------
// Helpers
// ---------------------------------------

function resolveFirebasePrivateKey() {
  const base64Key = process.env.FIREBASE_PRIVATE_KEY_BASE64;
  if (base64Key && base64Key.trim()) {
    try {
      const decoded = Buffer.from(base64Key.trim(), 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) return decoded.replace(/\r/g, '');
      console.warn('FIREBASE_PRIVATE_KEY_BASE64 presente pero no parece contener una clave PEM válida.');
    } catch (error) {
      console.warn('No se pudo decodificar FIREBASE_PRIVATE_KEY_BASE64:', error.message);
    }
  }

  const raw = process.env.FIREBASE_PRIVATE_KEY;
  if (raw && raw.trim()) {
    return raw.trim().replace(/\\n/g, '\n').replace(/\r/g, '');
  }
  return null;
}

function slugify(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/--+/g, '-')
    .slice(0, 64);
}

function encodePublicId(num) {
  const value = Math.max(1, Number(num) || 1);
  return value.toString(36).padStart(6, '0').toUpperCase();
}

async function getNextSequence(name) {
  const counters = getCollection('counters');
  const { value } = await counters.findOneAndUpdate(
    { _id: name },
    { $inc: { next: 1 } },
    {
      upsert: true,
      returnDocument: 'after',
      projection: { next: 1 }
    }
  );

  if (value && Number.isFinite(value.next)) {
    return value.next;
  }

  const fallback = await counters.findOne({ _id: name }, { projection: { next: 1 } });
  if (fallback && Number.isFinite(fallback.next)) {
    return fallback.next;
  }

  await counters.updateOne(
    { _id: name },
    { $set: { next: 1 } },
    { upsert: true }
  );
  return 1;
}

async function generateReviewPublicId() {
  const next = await getNextSequence('reviewPublicId');
  return encodePublicId(next);
}

async function ensurePlaceSlug(name) {
  const base = slugify(name);
  const places = getCollection('places');
  let candidate = base || encodePublicId(await getNextSequence('placeSlug'));
  let suffix = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await places.findOne({ slug: candidate }, { projection: { _id: 1 } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function toObjectId(value) {
  if (!value) return null;
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
}

function mapPlaceDoc(doc) {
  if (!doc) return null;
  const coords = doc.location?.type === 'Point' && Array.isArray(doc.location.coordinates)
    ? { lat: doc.location.coordinates[1], lng: doc.location.coordinates[0] }
    : null;
  return {
    id: doc.slug,
    name: doc.name,
    address: doc.address || '',
    coords,
    photo: Array.isArray(doc.photos) && doc.photos.length ? doc.photos[0] : ''
  };
}

function mapImageDoc(doc) {
  if (!doc) return null;
  return {
    id: doc._id ? doc._id.toString() : null,
    url: doc.url || '',
    provider: doc.provider || 'manual',
    thumbnail: doc.thumbnailUrl || null,
    width: doc.width || null,
    height: doc.height || null,
    size: doc.size || null,
    mimeType: doc.mimeType || null,
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.getTime() : Date.parse(doc.createdAt || '') || null
  };
}

function mapReviewDoc(doc, myVotes, likedByMap, dislikedByMap) {
  const placeDoc = doc.place || null;
  const coords = placeDoc?.location?.type === 'Point' && Array.isArray(placeDoc.location.coordinates)
    ? { lat: placeDoc.location.coordinates[1], lng: placeDoc.location.coordinates[0] }
    : null;

  const stats = doc.stats || {};
  const images = Array.isArray(doc.images) ? doc.images : [];

  const primaryPhoto =
    images[0]?.url ||
    (Array.isArray(placeDoc?.photos) && placeDoc.photos.length ? placeDoc.photos[0] : '') ||
    '';

  const mappedTags = Array.isArray(doc.tags) ? doc.tags : [];

  const reactionSummary = {
    likes: Number(stats.likes) || 0,
    dislikes: Number(stats.dislikes) || 0
  };

  const likedBy = likedByMap.get(doc.publicId) || [];
  const dislikedBy = dislikedByMap.get(doc.publicId) || [];
  const myVote = myVotes.get(doc.publicId) || 0;

  return {
    id: doc.publicId,
    placeId: placeDoc?.slug || doc.placeSlug || '',
    city: placeDoc?.city || '',
    rating: Number(doc.rating) || 0,
    photo: primaryPhoto,
    note: doc.note || '',
    tags: mappedTags,
    userId: null,
    userUid: doc.authorUid || null,
    userName: doc.authorDisplayName || '',
    up: reactionSummary.likes,
    down: reactionSummary.dislikes,
    createdAt:
      doc.createdAt instanceof Date
        ? doc.createdAt.getTime()
        : typeof doc.createdAt === 'number'
        ? doc.createdAt
        : Date.parse(doc.createdAt) || Date.now(),
    coords,
    images,
    myVote,
    likedBy,
    dislikedBy,
    reactionSummary
  };
}

async function loadReactionData(publicIds, currentUid) {
  if (!publicIds.length) {
    return { myVotes: new Map(), likedBy: new Map(), dislikedBy: new Map() };
  }

  const reactions = getCollection('review_reactions');
  const limit = Math.max(24, publicIds.length * 24);
  const docs = await reactions
    .find({ reviewPublicId: { $in: publicIds } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();

  const deriveValue = doc => {
    if (!doc) return 0;
    if (typeof doc.value === 'number') return doc.value;
    if (doc.liked) return 1;
    if (doc.disliked) return -1;
    return 0;
  };

  const myVotes = new Map();
  const likedByMap = new Map();
  const dislikedByMap = new Map();

  docs.forEach(doc => {
    const reviewPublicId = doc.reviewPublicId;

    const voteValue = deriveValue(doc);

    if (currentUid && doc.uid === currentUid && !myVotes.has(reviewPublicId)) {
      myVotes.set(reviewPublicId, voteValue);
    }

    const sample = {
      uid: doc.uid,
      displayName: doc.userDisplayName || null,
      photoURL: doc.userPhotoURL || null,
      value: voteValue,
      liked: Boolean(doc.liked || voteValue === 1),
      disliked: Boolean(doc.disliked || voteValue === -1),
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.getTime()
          : Date.parse(doc.updatedAt || '') || null
    };

    if (sample.liked) {
      const list = likedByMap.get(reviewPublicId) || [];
      if (list.length < 12) list.push(sample);
      likedByMap.set(reviewPublicId, list);
    }
    if (sample.disliked) {
      const list = dislikedByMap.get(reviewPublicId) || [];
      if (list.length < 12) list.push(sample);
      dislikedByMap.set(reviewPublicId, list);
    }
  });

  return { myVotes, likedBy: likedByMap, dislikedBy: dislikedByMap };
}

function buildReviewsPipeline(filter = {}, limit = 100) {
  return [
    { $match: filter },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
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
        from: 'review_images',
        let: { reviewId: '$publicId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$reviewPublicId', '$$reviewId'] } } },
          { $sort: { position: 1 } },
          {
            $lookup: {
              from: 'images',
              localField: 'imageId',
              foreignField: '_id',
              as: 'image'
            }
          },
          { $unwind: '$image' },
          {
            $project: {
              _id: 0,
              id: { $toString: '$image._id' },
              url: '$image.url',
              thumbnail: '$image.thumbnailUrl',
              provider: '$image.provider'
            }
          }
        ],
        as: 'images'
      }
    },
    {
      $lookup: {
        from: 'review_tags',
        let: { reviewId: '$publicId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$reviewPublicId', '$$reviewId'] } } },
          {
            $lookup: {
              from: 'catalog_tags',
              localField: 'tagId',
              foreignField: '_id',
              as: 'tag'
            }
          },
          { $unwind: '$tag' },
          {
            $project: {
              _id: 0,
              slug: '$tag.slug',
              label: '$tag.label'
            }
          }
        ],
        as: 'tagDetails'
      }
    },
    {
      $addFields: {
        place: { $arrayElemAt: ['$place', 0] },
        tags: {
          $map: {
            input: '$tagDetails',
            as: 'tag',
            in: '$$tag.slug'
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        publicId: 1,
        legacyId: 1,
        placeId: 1,
        placeSlug: 1,
        place: 1,
        authorUid: 1,
        authorDisplayName: 1,
        authorPhotoURL: 1,
        rating: 1,
        note: 1,
        summary: 1,
        tags: 1,
        stats: 1,
        visibility: 1,
        moderation: 1,
        createdAt: 1,
        updatedAt: 1,
        images: 1
      }
    }
  ];
}

async function fetchReviews(filter = {}, { limit = 100, currentUid = null } = {}) {
  const reviewsCollection = getCollection('reviews');
  const pipeline = buildReviewsPipeline(filter, limit);
  const docs = await reviewsCollection.aggregate(pipeline).toArray();
  const publicIds = docs.map(doc => doc.publicId);
  const { myVotes, likedBy, dislikedBy } = await loadReactionData(publicIds, currentUid);
  return docs.map(doc => mapReviewDoc(doc, myVotes, likedBy, dislikedBy));
}

async function ensureTags(tagStrings) {
  if (!Array.isArray(tagStrings) || !tagStrings.length) return [];
  const normalized = [...new Set(tagStrings.map(tag => slugify(tag)).filter(Boolean))];
  if (!normalized.length) return [];

  const tagsCollection = getCollection('catalog_tags');
  const existing = await tagsCollection.find({ slug: { $in: normalized } }).toArray();
  const existingMap = new Map(existing.map(tag => [tag.slug, tag]));

  const now = new Date();
  const missing = normalized.filter(slug => !existingMap.has(slug));
  if (missing.length) {
    const insertDocs = missing.map(slug => ({
      slug,
      label: `#${slug}`,
      createdAt: now,
      updatedAt: now
    }));
    const result = await tagsCollection.insertMany(insertDocs);
    insertDocs.forEach((doc, index) => {
      doc._id = result.insertedIds[index];
      existingMap.set(doc.slug, doc);
    });
  }

  return normalized.map(slug => existingMap.get(slug)).filter(Boolean);
}

async function resolvePlace(payload, authorUid) {
  const places = getCollection('places');

  const bodyPlace = payload.place || {};
  const rawSlug = payload.placeSlug || payload.placeId || bodyPlace.slug;
  if (typeof rawSlug === 'string' && rawSlug.trim()) {
    const place = await places.findOne({ slug: rawSlug.trim() });
    if (place) return place;
  }

  if (!bodyPlace.name || !bodyPlace.coords) {
    throw new Error('place_required');
  }

  const coords = bodyPlace.coords;
  if (
    !coords ||
    typeof coords.lat !== 'number' ||
    typeof coords.lng !== 'number'
  ) {
    throw new Error('place_coords_invalid');
  }

  const now = new Date();
  const slug = await ensurePlaceSlug(bodyPlace.slug || bodyPlace.name);
  const placeDoc = {
    slug,
    name: bodyPlace.name,
    description: bodyPlace.description || '',
    address: bodyPlace.address || '',
    city: bodyPlace.city || '',
    country: bodyPlace.country || 'CR',
    openingHours: Array.isArray(bodyPlace.openingHours) ? bodyPlace.openingHours : [],
    photos: Array.isArray(bodyPlace.photos) ? bodyPlace.photos : [],
    location: { type: 'Point', coordinates: [coords.lng, coords.lat] },
    stats: { reviews: 0, avgRating: 0 },
    meta: { createdByUid: authorUid, lastReviewAt: null },
    createdAt: now,
    updatedAt: now
  };

  const { insertedId } = await places.insertOne(placeDoc);
  placeDoc._id = insertedId;

  const requestedCategories = Array.isArray(bodyPlace.categories) ? bodyPlace.categories : [];
  if (requestedCategories.length) {
    const categoriesCollection = getCollection('catalog_categories');
    const categoryDocs = await categoriesCollection
      .find({ slug: { $in: requestedCategories.map(slugify) } })
      .toArray();
    if (categoryDocs.length) {
      const placeCategories = getCollection('place_categories');
      const pivotDocs = categoryDocs.map(cat => ({
        placeId: insertedId,
        categoryId: cat._id,
        createdAt: now,
        createdByUid: authorUid
      }));
      if (pivotDocs.length) await placeCategories.insertMany(pivotDocs);
    }
  }

  return placeDoc;
}

async function attachReviewTags(reviewPublicId, tags, createdByUid) {
  if (!tags.length) return;
  const reviewTags = getCollection('review_tags');
  const now = new Date();
  const pivotDocs = tags.map(tag => ({
    reviewPublicId,
    tagId: tag._id,
    createdAt: now,
    createdByUid
  }));
  await reviewTags.insertMany(pivotDocs);
}

async function attachReviewImages(reviewPublicId, imageIds, createdByUid) {
  if (!imageIds.length) return;
  const reviewImages = getCollection('review_images');
  const now = new Date();
  const pivotDocs = imageIds.map((imageId, index) => ({
    reviewPublicId,
    imageId,
    position: index,
    createdAt: now,
    createdByUid
  }));
  await reviewImages.insertMany(pivotDocs);
}

async function updatePlaceStats(placeDoc, rating) {
  const places = getCollection('places');
  const currentStats = placeDoc.stats || { reviews: 0, avgRating: 0 };
  const currentCount = Number(currentStats.reviews) || 0;
  const currentAvg = Number(currentStats.avgRating) || 0;
  const newCount = currentCount + 1;
  const newAvg = Number(((currentAvg * currentCount + rating) / newCount).toFixed(2));

  await places.updateOne(
    { _id: placeDoc._id },
    {
      $set: {
        'stats.reviews': newCount,
        'stats.avgRating': newAvg,
        updatedAt: new Date(),
        'meta.lastReviewAt': new Date()
      }
    }
  );
}

// ---------------------------------------
// Auth helpers
// ---------------------------------------

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'auth_required' });
  }
  const token = header.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'auth_required' });
  }
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    req.auth = decoded;
    req.userDoc = await ensureUserDocument(decoded);
    return next();
  } catch (error) {
    console.error('Error al verificar token:', error);
    return res.status(401).json({ error: 'invalid_token' });
  }
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
    console.warn('Token de Firebase inválido (se ignora):', error.message);
    return null;
  }
}

async function ensureUserDocument(decoded) {
  const users = getCollection('users');
  const now = new Date();
  const profile = {
    uid: decoded.uid,
    email: decoded.email || null,
    emailVerified: Boolean(decoded.email_verified),
    displayName: decoded.name || decoded.email || 'Visitante',
    photoURL: decoded.picture || null,
    role: 'usr',
    stats: { reviews: 0, reactions: 0, karma: 0 },
    meta: {
      locale: decoded.locale || 'es-CR',
      lastLoginAt: now
    },
    updatedAt: now
  };

  const { value } = await users.findOneAndUpdate(
    { uid: decoded.uid },
    {
      $set: profile,
      $setOnInsert: {
        createdAt: now
      }
    },
    {
      returnDocument: 'after',
      upsert: true
    }
  );

  if (value) {
    return value;
  }

  const fallback = await users.findOne({ uid: decoded.uid });
  if (fallback) {
    return fallback;
  }

  const inserted = {
    ...profile,
    createdAt: now
  };
  await users.insertOne(inserted);
  return inserted;
}

// ---------------------------------------
// Express App
// ---------------------------------------

const app = express();

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const corsOptions = allowedOrigins.length
  ? { origin: allowedOrigins, credentials: true }
  : { origin: true, credentials: true };

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

// Static frontend (opcional)
app.use(express.static(STATIC_DIR));

// ---------------------------------------
// API Routes
// ---------------------------------------

app.get('/api/health', async (_req, res) => {
  try {
    await mongoDb.command({ ping: 1 });
    res.json({ ok: true });
  } catch (error) {
    console.error('Health check falló:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/auth/session', requireAuth, async (req, res) => {
  const userDoc = req.userDoc || (await ensureUserDocument(req.auth));
  res.json({
    user: {
      uid: userDoc.uid,
      email: userDoc.email || null,
      emailVerified: Boolean(userDoc.emailVerified),
      displayName: userDoc.displayName || 'Visitante',
      photoURL: userDoc.photoURL || null,
      role: userDoc.role || 'usr',
      stats: userDoc.stats || { reviews: 0, reactions: 0, karma: 0 }
    }
  });
});

app.get('/api/places', async (req, res) => {
  try {
    const placesCollection = getCollection('places');
    const docs = await placesCollection.find().sort({ name: 1 }).limit(200).toArray();
    res.json({ places: docs.map(mapPlaceDoc).filter(Boolean) });
  } catch (error) {
    console.error('Error al listar lugares:', error);
    res.status(500).json({ error: 'cannot_list_places' });
  }
});

app.post('/api/places', requireAuth, async (req, res) => {
  const payload = req.body || {};
  try {
    const placeDoc = await resolvePlace(
      { place: payload },
      req.auth.uid
    );
    res.status(201).json({ place: mapPlaceDoc(placeDoc) });
  } catch (error) {
    console.error('Error al crear lugar:', error);
    if (error.message === 'place_required') {
      return res.status(400).json({ error: 'place_data_required' });
    }
    if (error.message === 'place_coords_invalid') {
      return res.status(400).json({ error: 'place_coords_invalid' });
    }
    res.status(500).json({ error: 'cannot_create_place' });
  }
});

app.post('/api/images', requireAuth, async (req, res) => {
  const payload = req.body || {};
  const rawUrl = payload.url || payload.u;
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!url) {
    return res.status(400).json({ error: 'image_url_required' });
  }

  const provider =
    typeof payload.provider === 'string'
      ? payload.provider
      : typeof payload.pv === 'string'
      ? payload.pv
      : 'fb';

  const imageDoc = {
    ownerUid: req.auth.uid,
    provider,
    url,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  if (typeof payload.thumbnailUrl === 'string' && payload.thumbnailUrl.trim()) {
    imageDoc.thumbnailUrl = payload.thumbnailUrl.trim();
  } else if (typeof payload.thumb === 'string' && payload.thumb.trim()) {
    imageDoc.thumbnailUrl = payload.thumb.trim();
  }

  const widthCandidate = payload.width ?? payload.w;
  const heightCandidate = payload.height ?? payload.h;
  const sizeCandidate = payload.size ?? payload.s;

  if (Number.isFinite(Number(widthCandidate))) {
    imageDoc.width = Number(widthCandidate);
  }
  if (Number.isFinite(Number(heightCandidate))) {
    imageDoc.height = Number(heightCandidate);
  }
  if (Number.isFinite(Number(sizeCandidate))) {
    imageDoc.size = Number(sizeCandidate);
  }

  if (typeof payload.mimeType === 'string' && payload.mimeType.trim()) {
    imageDoc.mimeType = payload.mimeType.trim();
  } else if (typeof payload.mt === 'string' && payload.mt.trim()) {
    imageDoc.mimeType = payload.mt.trim();
  }

  Object.keys(imageDoc).forEach(key => {
    if (imageDoc[key] === undefined || imageDoc[key] === null) {
      delete imageDoc[key];
    }
  });

  try {
    const images = getCollection('images');
    const { insertedId } = await images.insertOne(imageDoc);
    const inserted = await images.findOne({ _id: insertedId });
    res.status(201).json({ image: mapImageDoc(inserted) });
  } catch (error) {
    console.error('Error al guardar metadata de imagen:', error);
    if (error?.code === 121) {
      if (error?.errInfo) {
        console.error('Schema validation details:', JSON.stringify(error.errInfo, null, 2));
      }
      return res.status(400).json({ error: 'image_metadata_invalid', details: error?.errInfo });
    }
    res.status(500).json({ error: 'cannot_store_image_metadata' });
  }
});

app.post('/api/admin/reset', requireAuth, async (req, res) => {
  // Endpoint de compatibilidad para el botón "Limpiar" del frontend legacy.
  try {
    await Promise.all([
      getCollection('places').deleteMany({}),
      getCollection('reviews').deleteMany({}),
      getCollection('images').deleteMany({}),
      getCollection('review_images').deleteMany({}),
      getCollection('review_tags').deleteMany({}),
      getCollection('review_reactions').deleteMany({}),
      getCollection('place_categories').deleteMany({}),
      getCollection('audit_events').deleteMany({})
    ]);

    await getCollection('counters').updateMany(
      { _id: { $in: ['reviewPublicId', 'placeSlug'] } },
      { $set: { next: 1 } }
    );

    res.json({
      ok: true,
      message: 'Se limpiaron las colecciones principales. Ejecuta el script de seed si deseas datos por defecto.'
    });
  } catch (error) {
    console.error('Error al limpiar datos:', error);
    res.status(500).json({ ok: false, error: 'cannot_reset_database' });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const auth = await optionalAuth(req);
    const reviews = await fetchReviews({}, { limit: 100, currentUid: auth?.decoded?.uid || null });
    res.json({ reviews });
  } catch (error) {
    console.error('Error al listar reseñas:', error);
    res.status(500).json({ error: 'cannot_list_reviews' });
  }
});

app.post('/api/reviews', requireAuth, async (req, res) => {
  const body = req.body || {};
  try {
    const rating = Number(body.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating_invalid' });
    }

    const tags = Array.isArray(body.tags) ? body.tags : [];
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const summary = note ? note.slice(0, 160) : '';
    const imageIdsInput = Array.isArray(body.imageIds) ? body.imageIds : [];

    const placeDoc = await resolvePlace(body, req.auth.uid);
    const placeId = placeDoc._id;

    const tagsDocs = await ensureTags(tags);
    const reviewPublicId = await generateReviewPublicId();
    const now = new Date();

    const reviewsCollection = getCollection('reviews');
    const reviewDoc = {
      publicId: reviewPublicId,
      placeId,
      placeSlug: placeDoc.slug,
      authorUid: req.auth.uid,
      authorDisplayName: req.userDoc?.displayName || req.auth.name || 'Visitante',
      authorPhotoURL: req.userDoc?.photoURL || null,
      rating,
      note,
      summary,
      tags: tagsDocs.map(tag => tag.slug),
      stats: { likes: 0, dislikes: 0 },
      visibility: 'public',
      moderation: {
        status: 'approved',
        reviewedByUid: null,
        reviewedAt: now
      },
      createdAt: now,
      updatedAt: now
    };

    await reviewsCollection.insertOne(reviewDoc);

    if (tagsDocs.length) {
      await attachReviewTags(reviewPublicId, tagsDocs, req.auth.uid);
    }

    if (imageIdsInput.length) {
      const imagesCollection = getCollection('images');
      const imageObjectIds = imageIdsInput
        .map(toObjectId)
        .filter(Boolean);

      if (imageObjectIds.length) {
        const ownedImages = await imagesCollection
          .find({ _id: { $in: imageObjectIds }, ownerUid: req.auth.uid })
          .toArray();
        if (ownedImages.length) {
          await attachReviewImages(
            reviewPublicId,
            ownedImages.map(image => image._id),
            req.auth.uid
          );
        }
      }
    }

    await updatePlaceStats(placeDoc, rating);

    const [createdReview] = await fetchReviews(
      { publicId: reviewPublicId },
      { limit: 1, currentUid: req.auth.uid }
    );

    res.status(201).json({
      review: createdReview,
      place: mapPlaceDoc(await getCollection('places').findOne({ _id: placeId }))
    });
  } catch (error) {
    console.error('Error al crear reseña:', error);
    if (error.message === 'place_required' || error.message === 'place_coords_invalid') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'cannot_create_review' });
  }
});

app.post('/api/reviews/:id/vote', requireAuth, async (req, res) => {
  const reviewId = String(req.params.id || '').trim();
  if (!reviewId) {
    return res.status(400).json({ error: 'invalid_review_id' });
  }

  const value = Number(req.body?.value ?? req.body?.delta);
  if (![1, 0, -1].includes(value)) {
    return res.status(400).json({ error: 'invalid_vote_value' });
  }

  try {
    const reviewsCollection = getCollection('reviews');
    const reviewDoc = await reviewsCollection.findOne({ publicId: reviewId });
    if (!reviewDoc) {
      return res.status(404).json({ error: 'review_not_found' });
    }

    const reactions = getCollection('review_reactions');
    const now = new Date();

    const existingReaction = await reactions.findOne({
      reviewPublicId: reviewDoc.publicId,
      uid: req.auth.uid
    });

    const deriveValue = doc => {
      if (!doc) return 0;
      if (typeof doc.value === 'number') return doc.value;
      if (doc.liked) return 1;
      if (doc.disliked) return -1;
      return 0;
    };

    const existingValue = deriveValue(existingReaction);

    if (existingReaction && existingValue === value) {
      return res.json({
        reviewId: reviewDoc.publicId,
        up: Number(reviewDoc.stats?.likes) || 0,
        down: Number(reviewDoc.stats?.dislikes) || 0,
        my: value
      });
    }

    const liked = value === 1;
    const disliked = value === -1;

    const reactionPayload = {
      reviewPublicId: reviewDoc.publicId,
      reviewObjectId: reviewDoc._id,
      reviewId: reviewDoc.publicId,
      uid: req.auth.uid,
      userDisplayName: req.userDoc?.displayName || req.auth.name || req.userDoc?.email || null,
      userPhotoURL: req.userDoc?.photoURL || null,
      liked,
      disliked,
      updatedAt: now
    };

    if (value !== 0) {
      reactionPayload.value = value;
    }

    let likesDelta = 0;
    let dislikesDelta = 0;

    if (existingValue === 1) likesDelta -= 1;
    if (existingValue === -1) dislikesDelta -= 1;

    if (liked) likesDelta += 1;
    if (disliked) dislikesDelta += 1;

    if (existingReaction) {
      if (value === 0) {
        await reactions.deleteOne({ _id: existingReaction._id });
      } else {
        await reactions.updateOne(
          { _id: existingReaction._id },
          { $set: reactionPayload }
        );
      }
    } else if (value !== 0) {
      await reactions.updateOne(
        { reviewPublicId: reviewDoc.publicId, uid: req.auth.uid },
        {
          $set: reactionPayload,
          $setOnInsert: { createdAt: now }
        },
        { upsert: true }
      );
    }

    const currentStats = reviewDoc.stats || { likes: 0, dislikes: 0 };
    const newStats = {
      likes: Math.max(0, (currentStats.likes || 0) + likesDelta),
      dislikes: Math.max(0, (currentStats.dislikes || 0) + dislikesDelta)
    };

    await reviewsCollection.updateOne(
      { _id: reviewDoc._id },
      {
        $set: {
          'stats.likes': newStats.likes,
          'stats.dislikes': newStats.dislikes,
          updatedAt: now
        }
      }
    );

    res.json({
      reviewId: reviewDoc.publicId,
      up: newStats.likes,
      down: newStats.dislikes,
      my: value
    });
  } catch (error) {
    console.error('Error al registrar voto:', error);
    res.status(500).json({ error: 'cannot_register_vote' });
  }
});

// Fallback: servir frontend si existe (Express 5 compatible)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(STATIC_DIR, 'index.html'), error => {
    if (error) next();
  });
});

// ---------------------------------------
// Inicialización
// ---------------------------------------

async function startServer() {
  try {
    await mongoClient.connect();
    mongoDb = mongoClient.db(MONGODB_DB_NAME);
    console.log(`MongoDB conectado a ${MONGODB_DB_NAME}`);

    app.listen(PORT, HOST, () => {
      const localUrl = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
      console.log(`Servidor escuchando en ${localUrl}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar el servidor:', error);
    process.exit(1);
  }
}

startServer();

async function gracefulShutdown() {
  try {
    await mongoClient.close();
  } catch (error) {
    console.warn('Error al cerrar MongoDB:', error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
