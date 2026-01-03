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
    const plates = db.collection('license_plates');
    const since = new Date(Date.now() - 24*3600*1000);
    console.time('agg');
    const agg = await plates.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $facet: {
          all: [{ $count: 'total_detections' }],
          by_camera: [{ $group: { _id: '$camera_name', count: { $sum: 1 } } }],
          unique_plate_count: [
            { $group: { _id: '$license_plate' } },
            { $count: 'unique_plates' }
          ]
      } }
    ]).toArray();
    console.timeEnd('agg');
    // Privacy: do not log raw license plate values. Log only aggregated counts.
    const stats = {
      total_detections: (agg[0].all && agg[0].all[0] && agg[0].all[0].total_detections) || 0,
      unique_plates: (agg[0].unique_plate_count && agg[0].unique_plate_count[0] && agg[0].unique_plate_count[0].unique_plates) || 0,
      by_camera: agg[0].by_camera || []
    };
    console.log('stats:', JSON.stringify(stats, null, 2));
    await client.close();
  }catch(e){console.error('ERR', e);process.exit(2);} 
})();
