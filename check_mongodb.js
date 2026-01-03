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
        console.log(`\n📊 Total sessions in MongoDB: ${all.length}\n`);
        
        all.forEach((session, index) => {
            console.log(`[${index}] ID: "${session._id}"`);
            console.log(`    Email: ${session.email}`);
            console.log(`    LoginTime: ${new Date(session.expires).toLocaleString()}`);
            console.log(`---`);
        });
        
        await client.close();
    } catch (e) {
        console.error('❌ Error:', e.message);
    }
}

check();
