import pg from 'pg';
import { config } from 'dotenv';

config({ path: '.env.production' });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function dropTypes() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Dropping existing types (if any)...\n');

    const types = ['sync_mode', 'sync_status'];

    for (const type of types) {
      try {
        await client.query(`DROP TYPE IF EXISTS ${type} CASCADE`);
        console.log(`✅ Dropped type: ${type}`);
      } catch (err) {
        console.log(`⚠️  Could not drop ${type}:`, err.message);
      }
    }

    console.log('\n✅ Cleanup complete');
  } finally {
    client.release();
    await pool.end();
  }
}

dropTypes().catch(console.error);
