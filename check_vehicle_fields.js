const { MongoClient } = require('mongodb');
(async ()=>{
  try{
    const url = process.env.MONGO_URL;
    if (!url) {
        console.error('MONGO_URL not set. See .env.example');
        process.exit(1);
    }
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db();
    const doc = await db.collection('license_plates').findOne({ vehicle_color: { $ne: null } });
    console.log('found:', !!doc);
    if (doc) console.log(JSON.stringify(doc, null, 2));
    await client.close();
  }catch(e){
    console.error('ERR', e && e.message);
    process.exit(2);
  }
})();
