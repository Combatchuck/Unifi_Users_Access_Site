const MongoClient = require('mongodb').MongoClient;

const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) { console.error('MONGO_URL not set. See .env.example'); process.exit(1); }
const client = new MongoClient(mongoUrl);

async function check() {
    try {
        await client.connect();
        const db = client.db('web-portal');
        const sessions = db.collection('sessions');
        
        const all = await sessions.find({}).toArray();
        console.log('\n=== SESSIONS IN MONGODB ===');
        all.forEach(session => {
            console.log(`ID: "${session._id}"`);
            console.log(`Email: ${session.email}`);
            console.log(`---`);
        });
        
        await client.close();
    } catch (e) {
        console.error(e);
    }
}

check();
