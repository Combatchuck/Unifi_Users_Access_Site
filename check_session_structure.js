const MongoClient = require('mongodb').MongoClient;

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) { console.error('MONGO_URL not set. See .env.example'); process.exit(1); }
const client = new MongoClient(mongoUrl);

async function check() {
    try {
        await client.connect();
        const db = client.db('web-portal');
        const sessions = db.collection('sessions');
        
        const one = await sessions.findOne({});
        console.log('\n📋 Session Document Structure:');
        console.log(JSON.stringify(one, null, 2));
        
        await client.close();
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

check();
