const { MongoClient } = require('mongodb');
const url = process.env.MONGO_URL;
if (!url) {
  console.error('MONGO_URL not set. See .env.example');
  process.exit(1);
}
(async ()=>{
  try{
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db();
    const coll = db.collection('license_plates');
    const count = await coll.countDocuments();
    console.log('count:', count);
    // Privacy: do not log raw license_plate values. Project them out of the result.
    const latest = await coll.find({}, { projection: { license_plate: 0 } }).sort({ timestamp: -1 }).limit(5).toArray();
    console.log('latest 5 (license_plate omitted):');
    latest.forEach(d => console.log(JSON.stringify(d)));
    await client.close();
  }catch(e){
    console.error('ERR', e && e.message);
    process.exit(2);
  }
})();
