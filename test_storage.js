const { MongoClient } = require('mongodb');

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('MONGO_URL not set. See .env.example');
  process.exit(1);
}

async function checkDbStats() {
    const client = new MongoClient(mongoUrl);
    try {
        await client.connect();
        const db = client.db();
        
        const stats = await db.stats();
        
        console.log('\n=== DATABASE STORAGE STATS ===\n');
        console.log(`Database: ${db.getName()}`);
        console.log(`Data Size: ${(stats.dataSize / (1024*1024*1024)).toFixed(3)} GB`);
        console.log(`Index Size: ${(stats.indexSize / (1024*1024*1024)).toFixed(3)} GB`);
        console.log(`Storage Size: ${(stats.storageSize / (1024*1024*1024)).toFixed(3)} GB`);
        console.log(`Total Collections: ${stats.collections}`);
        console.log(`Document Count: ${stats.objects}`);
        console.log(`Avg Doc Size: ${((stats.dataSize / stats.objects) / 1024).toFixed(2)} KB\n`);
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await client.close();
    }
}

checkDbStats();
