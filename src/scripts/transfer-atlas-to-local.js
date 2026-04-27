/**
 * Data Transfer Script: MongoDB Atlas to Local MongoDB
 * 
 * This script transfers all data from MongoDB Atlas to your local MongoDB database.
 * 
 * IMPORTANT: This script PRESERVES _id fields, so documents will have the SAME IDs
 * in both Atlas and local databases. This ensures relationships and references are maintained.
 * 
 * Usage:
 * 1. Set ATLAS_MONGODB_URL in .env or pass as environment variable
 * 2. Set LOCAL_MONGODB_URL in .env or pass as environment variable
 * 3. Run from project root: node src/scripts/transfer-atlas-to-local.js
 * 
 * Options:
 * - --dry-run: Preview what would be transferred without actually transferring
 * - --collections: Comma-separated list of collections to transfer (default: all)
 * - --drop: Drop existing collections in local before transferring (USE WITH CAUTION)
 * - --atlas-db: Atlas database name (default: Addonbackupdatabase)
 * 
 * Environment Variables:
 * - LOCAL_MONGODB_URL: Local MongoDB connection string
 * - ATLAS_MONGODB_URL: Atlas MongoDB connection string (will use Addonbackupdatabase as database name)
 * - ATLAS_DB_NAME: Atlas database name (default: Addonbackupdatabase)
 * # Local → Atlas
node src/scripts/transfer-local-to-atlas.js --dry-run
node src/scripts/transfer-local-to-atlas.js

# Atlas → Local
node src/scripts/transfer-atlas-to-local.js --dry-run
node src/scripts/transfer-atlas-to-local.js
 */

// Node 25+ made url.parse() throw in some MongoDB driver pre-checks.
// The mongodb driver 3.x uses url.parse() before its own parsing, so we patch it
// to return best-effort output instead of throwing.
import url from 'url';
const _origUrlParse = url.parse;
url.parse = function patchedParse(urlStr, ...args) {
  try {
    return _origUrlParse.call(this, urlStr, ...args);
  } catch {
    const firstHost = String(urlStr).replace(/(@[^,/]+),([^/])/, '$1/$2');
    return _origUrlParse.call(this, firstHost, ...args);
  }
};

const { default: mongoose } = await import('mongoose');
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Get database URLs from environment or use defaults
// Get database URLs from environment or use defaults
// Use standard connection string to bypass SRV lookup issues
const ATLAS_HOSTS = [
  'ac-26xn7fg-shard-00-00.0qimubb.mongodb.net:27017',
  'ac-26xn7fg-shard-00-01.0qimubb.mongodb.net:27017',
  'ac-26xn7fg-shard-00-02.0qimubb.mongodb.net:27017'
].join(',');
const FALLBACK_ATLAS_URL = `mongodb://${ATLAS_HOSTS}/Addonbackupdatabase?ssl=true&replicaSet=atlas-26xn7fg-shard-0&authSource=admin&retryWrites=true&w=majority`;

let ATLAS_MONGODB_URL = process.env.ATLAS_MONGODB_URL || process.env.MONGODB_URL;

// If we detect a specific SRV URL that we know fails, use the fallback.
// NOTE: This fallback is optional because it requires correctly encoded credentials.
// Set FORCE_DIRECT_ATLAS=1 to enable it; otherwise we keep mongodb+srv (preferred).
if (
  process.env.FORCE_DIRECT_ATLAS === '1' &&
  ATLAS_MONGODB_URL &&
  ATLAS_MONGODB_URL.includes('cluster0.0qimubb.mongodb.net') &&
  ATLAS_MONGODB_URL.startsWith('mongodb+srv://')
) {
  // Extract credentials
  try {
    // Handle passwords that may contain '@' by splitting at the LAST '@' in the authority part.
    const scheme = 'mongodb+srv://';
    const afterScheme = ATLAS_MONGODB_URL.slice(scheme.length);
    const atIdx = afterScheme.lastIndexOf('@');
    const credsPart = atIdx >= 0 ? afterScheme.slice(0, atIdx) : '';
    const colonIdx = credsPart.indexOf(':');
    const user = colonIdx >= 0 ? credsPart.slice(0, colonIdx) : '';
    const pass = colonIdx >= 0 ? credsPart.slice(colonIdx + 1) : '';
    if (user && pass) {
      // Credentials may contain URL-reserved chars; encode so the Mongo parser accepts the URI.
      const encUser = encodeURIComponent(user);
      const encPass = encodeURIComponent(pass);
      ATLAS_MONGODB_URL = `mongodb://${encUser}:${encPass}@${ATLAS_HOSTS}/Addonbackupdatabase?ssl=true&replicaSet=atlas-26xn7fg-shard-0&authSource=admin&retryWrites=true&w=majority`;
      console.log('ℹ️  Using direct connection string to bypass DNS/SRV issues');
    }
  } catch {
    // If parsing fails, keep the original mongodb+srv URL.
  }
}
const LOCAL_MONGODB_URL = process.env.LOCAL_MONGODB_URL || 'mongodb://127.0.0.1:27017/addon';

// Parse command line arguments for database name override
const args = process.argv.slice(2);
const dbNameArg = args.find(arg => arg.startsWith('--atlas-db='));
const atlasDbName = dbNameArg ? dbNameArg.split('=')[1] : process.env.ATLAS_DB_NAME || 'Addonbackupdatabase';

// If ATLAS_MONGODB_URL is provided, replace the database name with the target database
if (ATLAS_MONGODB_URL) {
  // Replace database name in connection string
  ATLAS_MONGODB_URL = ATLAS_MONGODB_URL.replace(/\/[^/?]+(\?|$)/, `/${atlasDbName}$1`);
}

// Parse other command line arguments
const isDryRun = args.includes('--dry-run');
const dropCollections = args.includes('--drop');
const collectionsArg = args.find(arg => arg.startsWith('--collections='));
const collectionsToTransfer = collectionsArg ? collectionsArg.split('=')[1].split(',') : null;

if (!ATLAS_MONGODB_URL) {
  console.error('❌ Error: ATLAS_MONGODB_URL or MONGODB_URL environment variable is required');
  console.error('   Set it in your .env file or pass as environment variable');
  process.exit(1);
}

// MongoDB connection options
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

let atlasConnection = null;
let localConnection = null;

/**
 * Connect to Atlas MongoDB
 */
const connectAtlas = async () => {
  try {
    atlasConnection = await mongoose.createConnection(ATLAS_MONGODB_URL, mongooseOptions);
    console.log('✅ Connected to MongoDB Atlas');
    return atlasConnection;
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB Atlas:', error.message);
    throw error;
  }
};

/**
 * Connect to local MongoDB
 */
const connectLocal = async () => {
  try {
    localConnection = await mongoose.createConnection(LOCAL_MONGODB_URL, mongooseOptions);
    console.log('✅ Connected to Local MongoDB');
    return localConnection;
  } catch (error) {
    console.error('❌ Failed to connect to Local MongoDB:', error.message);
    throw error;
  }
};

/**
 * Get all collection names from a database
 */
const getCollections = async (db) => {
  const collections = await db.listCollections().toArray();
  return collections.map(col => col.name).filter(name => !name.startsWith('system.'));
};

/**
 * Get collection document count
 */
const getCollectionCount = async (db, collectionName) => {
  try {
    return await db.collection(collectionName).countDocuments();
  } catch (error) {
    console.error(`   ⚠️  Error counting ${collectionName}:`, error.message);
    return 0;
  }
};

/**
 * Transfer a single collection
 */
const transferCollection = async (atlasDb, localDb, collectionName, options = {}) => {
  const { dryRun = false, drop = false } = options;

  try {
    const atlasCollection = atlasDb.collection(collectionName);
    const localCollection = localDb.collection(collectionName);

    // Get document count
    const count = await getCollectionCount(atlasDb, collectionName);

    if (count === 0) {
      console.log(`   ⏭️  ${collectionName}: Empty collection, skipping`);
      return { transferred: 0, skipped: true };
    }

    console.log(`   📦 ${collectionName}: ${count} documents`);

    if (dryRun) {
      console.log(`      [DRY RUN] Would transfer ${count} documents`);
      return { transferred: count, skipped: false };
    }

    // Drop collection in local if requested
    if (drop) {
      try {
        await localCollection.drop();
        console.log(`      🗑️  Dropped existing collection in local database`);
      } catch (error) {
        // Collection might not exist, that's okay
        if (error.codeName !== 'NamespaceNotFound') {
          throw error;
        }
      }
    }

    // Get all documents from Atlas
    const documents = await atlasCollection.find({}).toArray();

    if (documents.length === 0) {
      return { transferred: 0, skipped: true };
    }

    // Insert documents into local in batches
    // IMPORTANT: Preserving _id fields so documents have same IDs in both databases
    const batchSize = 1000;
    let transferred = 0;

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      // Preserve _id fields - documents will have same IDs in both databases
      // This ensures relationships and references are maintained

      try {
        await localCollection.insertMany(batch, {
          ordered: false,  // Continue on duplicate key errors
          writeConcern: { w: 1 }  // Don't wait for all replicas
        });
        transferred += batch.length;
        process.stdout.write(`      📤 Transferred ${transferred}/${documents.length} documents...\r`);
      } catch (error) {
        // Handle duplicate key errors (documents with same _id already exist)
        if (error.code === 11000 || error.writeErrors) {
          console.log(`\n      ⚠️  Some documents already exist (duplicate _id), inserting one by one to skip duplicates...`);
          // Try inserting one by one to skip duplicates
          for (const doc of batch) {
            try {
              await localCollection.insertOne(doc);
              transferred++;
              process.stdout.write(`      📤 Transferred ${transferred}/${documents.length} documents...\r`);
            } catch (e) {
              // Skip duplicate key errors, throw other errors
              if (e.code !== 11000 && e.codeName !== 'DuplicateKey') {
                throw e;
              }
            }
          }
        } else {
          throw error;
        }
      }
    }

    console.log(`      ✅ Transferred ${transferred} documents`);

    return { transferred, skipped: false };

  } catch (error) {
    console.error(`      ❌ Error transferring ${collectionName}:`, error.message);
    throw error;
  }
};

/**
 * Main transfer function
 */
const transferData = async () => {
  try {
    console.log('🚀 Starting data transfer from MongoDB Atlas to Local...\n');
    console.log(`☁️  Atlas: ${ATLAS_MONGODB_URL.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
    console.log(`📊 Source Database: ${atlasDbName}`);
    console.log(`📡 Local: ${LOCAL_MONGODB_URL}\n`);

    if (isDryRun) {
      console.log('⚠️  DRY RUN MODE: No data will be transferred\n');
    }

    if (dropCollections) {
      console.log('⚠️  WARNING: Existing collections in local database will be DROPPED before transfer!\n');
    }

    // Connect to both databases
    const atlasDb = await connectAtlas();
    const localDb = await connectLocal();

    // Get database names
    const actualAtlasDbName = atlasDb.db.databaseName;
    const localDbName = localDb.db.databaseName;

    console.log(`\n📊 Atlas Database: ${actualAtlasDbName}`);
    console.log(`📊 Local Database: ${localDbName}\n`);

    // Get all collections
    const allCollections = await getCollections(atlasDb.db);
    const collections = collectionsToTransfer
      ? allCollections.filter(col => collectionsToTransfer.includes(col))
      : allCollections;

    if (collections.length === 0) {
      console.log('ℹ️  No collections found to transfer');
      return;
    }

    console.log(`📋 Found ${collections.length} collection(s) to transfer:\n`);

    // Show collection info
    for (const collectionName of collections) {
      const count = await getCollectionCount(atlasDb.db, collectionName);
      console.log(`   • ${collectionName}: ${count} documents`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('🔄 Starting Transfer...\n');

    const results = {
      total: collections.length,
      transferred: 0,
      failed: 0,
      skipped: 0,
      totalDocuments: 0
    };

    // Transfer each collection
    for (const collectionName of collections) {
      try {
        console.log(`\n📦 Transferring: ${collectionName}`);
        const result = await transferCollection(
          atlasDb.db,
          localDb.db,
          collectionName,
          { dryRun: isDryRun, drop: dropCollections }
        );

        if (result.skipped) {
          results.skipped++;
        } else {
          results.transferred++;
          results.totalDocuments += result.transferred;
        }
      } catch (error) {
        console.error(`\n❌ Failed to transfer ${collectionName}:`, error.message);
        results.failed++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📈 Transfer Summary:');
    console.log('='.repeat(80));
    console.log(`✅ Successfully transferred: ${results.transferred} collections`);
    console.log(`⏭️  Skipped (empty): ${results.skipped} collections`);
    console.log(`❌ Failed: ${results.failed} collections`);
    console.log(`📊 Total documents transferred: ${results.totalDocuments.toLocaleString()}`);

    if (isDryRun) {
      console.log('\n⚠️  This was a DRY RUN. No data was actually transferred.');
      console.log('   Run without --dry-run to perform the actual transfer.');
    } else {
      console.log('\n🎉 Data transfer completed successfully!');
    }

  } catch (error) {
    console.error('\n❌ Transfer failed:', error);
    throw error;
  } finally {
    // Close connections
    if (atlasConnection) {
      await atlasConnection.close();
      console.log('\n👋 Disconnected from MongoDB Atlas');
    }
    if (localConnection) {
      await localConnection.close();
      console.log('👋 Disconnected from Local MongoDB');
    }
  }
};

// Main execution
const main = async () => {
  try {
    await transferData();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
};

// Run the transfer
main();
