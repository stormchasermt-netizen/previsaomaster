import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

async function test() {
  const bucket = admin.storage().bucket('wrf-3km-imagens-diarias');
  const [files] = await bucket.getFiles({ prefix: '20251107_000000/mllr/' });
  
  if (files.length > 0) {
    const file = files[0];
    console.log("File name:", file.name);
    try {
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 1000 * 60 * 60 });
      console.log("Signed URL:", url);
    } catch (e) {
      console.error("Error getting signed url:", e);
    }
  }
}
test();