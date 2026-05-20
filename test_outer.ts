import axios from "axios";

async function run() {
  try {
    const res = await axios.get("https://music.163.com/song/media/outer/url?id=1813926556.mp3", {
      maxRedirects: 0,
      validateStatus: null,
    });
    console.log("Status:", res.status);
    console.log("Location:", res.headers.location);
  } catch(e) {
    console.error(e.message);
  }
}
run();
