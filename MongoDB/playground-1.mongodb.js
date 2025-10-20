//------------------------------------------------------------
// Inicialización completa de la base de datos LUGGO
// Ejecutar en mongosh conectado a tu cluster Atlas
//------------------------------------------------------------
use('Luggov2');

// 1. Limpiar base de datos actual
db.dropDatabase();

// 2. Catálogos básicos
db.createCollection('catalog_categories', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['slug', 'name'],
      properties: {
        slug: { bsonType: 'string', minLength: 1 },
        name: { bsonType: 'string', minLength: 1 },
        description: { bsonType: 'string' },
        icon: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  },
  validationLevel: 'moderate',
  validationAction: 'warn'
});
db.catalog_categories.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });

db.catalog_categories.insertMany([
  { slug: 'cafe',        name: 'Cafeterias',   description: 'Locales orientados a cafe o brunch',          createdAt: new Date(), updatedAt: new Date() },
  { slug: 'comida',      name: 'Restaurantes', description: 'Sodas y restaurantes',                       createdAt: new Date(), updatedAt: new Date() },
  { slug: 'aire-libre',  name: 'Aire libre',   description: 'Parques y espacios abiertos',                createdAt: new Date(), updatedAt: new Date() },
  { slug: 'estudio',     name: 'Espacios de estudio', description: 'Sitios recomendados para estudiar',   createdAt: new Date(), updatedAt: new Date() }
]);

db.createCollection('catalog_tags', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['slug', 'label'],
      properties: {
        slug: { bsonType: 'string', minLength: 1 },
        label: { bsonType: 'string', minLength: 1 },
        description: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  },
  validationLevel: 'moderate',
  validationAction: 'warn'
});
db.catalog_tags.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });

db.catalog_tags.insertMany([
  { slug: 'wifi',        label: '#wifi',        description: 'Wi-Fi estable',            createdAt: new Date(), updatedAt: new Date() },
  { slug: 'petfriendly', label: '#petfriendly', description: 'Admite mascotas',          createdAt: new Date(), updatedAt: new Date() },
  { slug: 'economico',   label: '#economico',   description: 'Opciones accesibles',       createdAt: new Date(), updatedAt: new Date() },
  { slug: 'vegetariano', label: '#vegetariano', description: 'Ofrece alternativas verdes',createdAt: new Date(), updatedAt: new Date() }
]);

// 3. Usuarios
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['uid', 'displayName', 'createdAt'],
      properties: {
        uid: { bsonType: 'string', minLength: 1 },
        email: { bsonType: 'string' },
        emailVerified: { bsonType: 'bool' },
        displayName: { bsonType: 'string', minLength: 1 },
        photoURL: { bsonType: 'string' },
        role: { enum: ['usr', 'mod', 'adm'] },
        stats: {
          bsonType: 'object',
          properties: {
            reviews: { bsonType: 'int' },
            reactions: { bsonType: 'int' },
            karma: { bsonType: 'int' }
          }
        },
        meta: {
          bsonType: 'object',
          properties: {
            locale: { bsonType: 'string' },
            lastLoginAt: { bsonType: 'date' }
          }
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  },
  validationLevel: 'moderate',
  validationAction: 'warn'
});
db.users.createIndex({ uid: 1 }, { unique: true, name: 'uid_unique' });
db.users.createIndex({ email: 1 }, { unique: true, sparse: true, name: 'email_unique' });

// 4. Lugares
db.createCollection('places', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['slug', 'name', 'location', 'createdAt'],
      properties: {
        slug: { bsonType: 'string', minLength: 1 },
        name: { bsonType: 'string', minLength: 1 },
        description: { bsonType: 'string' },
        address: { bsonType: 'string' },
        city: { bsonType: 'string' },
        country: { bsonType: 'string' },
        phone: { bsonType: 'string' },
        website: { bsonType: 'string' },
        openingHours: { bsonType: 'array' },
        photos: { bsonType: 'array' },
        location: {
          bsonType: 'object',
          required: ['type', 'coordinates'],
          properties: {
            type: { enum: ['Point'] },
            coordinates: { bsonType: 'array', items: { bsonType: 'double' }, minItems: 2, maxItems: 2 }
          }
        },
        stats: {
          bsonType: 'object',
          properties: {
            reviews: { bsonType: 'int' },
            avgRating: { bsonType: ['double', 'int'] }
          }
        },
        meta: {
          bsonType: 'object',
          properties: {
            createdByUid: { bsonType: 'string' },
            lastReviewAt: { bsonType: 'date' }
          }
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  },
  validationLevel: 'moderate',
  validationAction: 'warn'
});
db.places.createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });
db.places.createIndex({ name: 'text', address: 'text', city: 'text' }, { name: 'places_text_search' });
db.places.createIndex({ location: "2dsphere" }, { name: "location_2dsphere" });
db.places.createIndex({ "meta.createdByUid": 1, createdAt: -1 }, { name: "createdByUid_createdAt" });

// Pivote lugar ↔ categoría
db.createCollection('place_categories', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['placeId', 'categoryId'],
      properties: {
        placeId: { bsonType: 'objectId' },
        categoryId: { bsonType: 'objectId' },
        createdAt: { bsonType: 'date' },
        createdByUid: { bsonType: 'string' }
      }
    }
  }
});
db.place_categories.createIndex({ placeId: 1, categoryId: 1 }, { unique: true, name: 'place_category_unique' });
db.place_categories.createIndex({ categoryId: 1 }, { name: 'category_lookup' });

// 5. Imágenes y pivote
db.createCollection('images', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ownerUid', 'url', 'createdAt'],
      properties: {
        ownerUid: { bsonType: 'string', minLength: 1 },
        provider: { enum: ['fb', 'manual', 'url'] },
        url: { bsonType: 'string', minLength: 1 },
        thumbnailUrl: { bsonType: 'string' },
        width: { bsonType: ['int', 'double'] },
        height: { bsonType: ['int', 'double'] },
        size: { bsonType: 'int' },
        mimeType: { bsonType: 'string' },
        moderation: {
          bsonType: 'object',
          properties: {
            status: { enum: ['pending', 'approved', 'rejected'] },
            updatedAt: { bsonType: 'date' }
          }
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  }
});
db.images.createIndex({ ownerUid: 1, createdAt: -1 }, { name: 'owner_createdAt' });

db.createCollection('review_images', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['reviewPublicId', 'imageId', 'position'],
      properties: {
        reviewPublicId: { bsonType: 'string', minLength: 1 },
        imageId: { bsonType: 'objectId' },
        position: { bsonType: 'int' },
        createdAt: { bsonType: 'date' },
        createdByUid: { bsonType: 'string' }
      }
    }
  }
});
db.review_images.createIndex({ reviewPublicId: 1, imageId: 1 }, { unique: true, name: 'review_image_unique' });
db.review_images.createIndex({ reviewPublicId: 1, position: 1 }, { name: 'review_image_position' });

// 6. Reviews
db.createCollection('reviews', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['publicId', 'placeId', 'authorUid', 'rating', 'createdAt'],
      properties: {
        publicId: { bsonType: 'string', minLength: 6 },
        legacyId: { bsonType: 'string' },
        placeId: { bsonType: 'objectId' },
        placeSlug: { bsonType: 'string' },
        authorUid: { bsonType: 'string', minLength: 1 },
        authorDisplayName: { bsonType: 'string' },
        authorPhotoURL: { bsonType: 'string' },
        rating: { bsonType: 'int', minimum: 1, maximum: 5 },
        note: { bsonType: 'string' },
        summary: { bsonType: 'string' },
        tags: { bsonType: 'array' },
        stats: {
          bsonType: 'object',
          properties: {
            likes: { bsonType: 'int' },
            dislikes: { bsonType: 'int' }
          }
        },
        visibility: { enum: ['public', 'hidden', 'pending'] },
        moderation: {
          bsonType: 'object',
          properties: {
            status: { enum: ['pending', 'approved', 'rejected'] },
            reviewedByUid: { bsonType: 'string' },
            reviewedAt: { bsonType: 'date' }
          }
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  },
  validationLevel: 'moderate',
  validationAction: 'warn'
});
db.reviews.createIndex({ publicId: 1 }, { unique: true, name: 'publicId_unique' });
db.reviews.createIndex({ legacyId: 1 }, { unique: true, sparse: true, name: 'legacyId_unique' });
db.reviews.createIndex({ placeId: 1, createdAt: -1 }, { name: 'place_createdAt' });
db.reviews.createIndex({ authorUid: 1, createdAt: -1 }, { name: 'author_createdAt' });
db.reviews.createIndex({ visibility: 1, "moderation.status": 1 });
db.reviews.createIndex({ tags: 1 }, { name: 'tags_array' });

// Pivot review ↔ tag (para recuperar reviews por tag sin duplicar datos)
db.createCollection('review_tags', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['reviewPublicId', 'tagId'],
      properties: {
        reviewPublicId: { bsonType: 'string', minLength: 1 },
        tagId: { bsonType: 'objectId' },
        createdAt: { bsonType: 'date' },
        createdByUid: { bsonType: 'string' }
      }
    }
  }
});
db.review_tags.createIndex({ reviewPublicId: 1, tagId: 1 }, { unique: true, name: 'review_tag_unique' });
db.review_tags.createIndex({ tagId: 1 }, { name: 'tag_lookup' });

// 7. Reacciones
db.createCollection('review_reactions', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['reviewPublicId', 'uid', 'value', 'createdAt'],
      properties: {
        reviewPublicId: { bsonType: 'string', minLength: 1 },
        reviewLegacyId: { bsonType: 'string' },
        reviewObjectId: { bsonType: 'objectId' },
        uid: { bsonType: 'string', minLength: 1 },
        value: { enum: [1, -1], description: '1=like, -1=dislike' },
        userDisplayName: { bsonType: 'string' },
        userPhotoURL: { bsonType: 'string' },
        metadata: {
          bsonType: 'object',
          properties: {
            platform: { bsonType: 'string' },
            userAgent: { bsonType: 'string' }
          }
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  },
  validationLevel: 'moderate',
  validationAction: 'warn'
});
db.review_reactions.createIndex({ reviewPublicId: 1, uid: 1 }, { unique: true, name: 'reviewPublicId_1_uid_1' });
db.review_reactions.createIndex({ reviewLegacyId: 1, uid: 1 }, { name: 'reviewLegacyId_1_uid_1' });
db.review_reactions.createIndex({ reviewObjectId: 1 }, { name: 'reviewObjectId_lookup' });
db.review_reactions.createIndex({ uid: 1, updatedAt: -1 }, { name: 'user_recent_reactions' });

// 8. Contadores para generar IDs cortos
db.createCollection('counters', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'next'],
      properties: {
        _id: { bsonType: 'string' },
        next: { bsonType: 'int' }
      }
    }
  }
});
db.counters.insertMany([
  { _id: 'reviewPublicId', next: 1 },
  { _id: 'placeSlug', next: 1 }
]);

// 9. Auditoría opcional
db.createCollection('audit_events', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['entity', 'entityId', 'action', 'createdAt'],
      properties: {
        entity: { bsonType: 'string' },
        entityId: { bsonType: 'string' },
        action: { bsonType: 'string' },
        actorUid: { bsonType: 'string' },
        diff: { bsonType: 'object' },
        createdAt: { bsonType: 'date' },
        metadata: { bsonType: 'object' }
      }
    }
  }
});
db.audit_events.createIndex({ entity: 1, entityId: 1, createdAt: -1 }, { name: 'entity_entityId_createdAt' });

// 10. Semillas mínimas de ejemplo
const now = new Date();

const demoUser = {
  uid: 'demo-user-uid',
  email: 'demo@example.com',
  emailVerified: true,
  displayName: 'Usuario Demo',
  photoURL: null,
  role: 'usr',
  stats: { reviews: 0, reactions: 0, karma: 0 },
  meta: { locale: 'es-CR', lastLoginAt: now },
  createdAt: now,
  updatedAt: now
};
db.users.insertOne(demoUser);

const demoPlaceId = new ObjectId();
db.places.insertOne({
  _id: demoPlaceId,
  slug: 'demo-cafe',
  name: 'Demo Cafe',
  description: 'Lugar de prueba para validar la estructura.',
  address: 'Calle Falsa 123, San Jose',
  city: 'San Jose',
  country: 'CR',
  openingHours: [],
  photos: [],
  location: { type: 'Point', coordinates: [-84.0833, 9.9339] },
  stats: { reviews: 0, avgRating: 0 },
  meta: { createdByUid: demoUser.uid, lastReviewAt: null },
  createdAt: now,
  updatedAt: now
});
const cafeCategory = db.catalog_categories.findOne({ slug: 'cafe' });
if (cafeCategory) {
  db.place_categories.insertOne({
    placeId: demoPlaceId,
    categoryId: cafeCategory._id,
    createdAt: now,
    createdByUid: demoUser.uid
  });
}

//------------------------------------------------------------
// Fin del script de inicialización
//------------------------------------------------------------
