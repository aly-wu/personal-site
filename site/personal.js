function renderMediaItems(hostId, items, emptyMessage, showSubtitle = true) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.replaceChildren();
  if (!items.length) {
    const message = document.createElement("p");
    message.className = "goodreads-status";
    message.textContent = emptyMessage;
    host.appendChild(message);
    return;
  }
  items.forEach((item, index) => {
    const link = document.createElement("a");
    link.className = "media-card media-card-" + ((index % 4) + 1);
    link.href = item.link;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = item.subtitle ? `${item.title} - ${item.subtitle}` : item.title;
    if (item.cover) {
      const image = document.createElement("img");
      image.src = item.cover;
      image.alt = `${item.title} cover`;
      image.loading = "lazy";
      link.appendChild(image);
    }
    const title = document.createElement("strong");
    title.textContent = item.title;
    link.appendChild(title);
    if (showSubtitle && item.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.textContent = item.subtitle;
      link.appendChild(subtitle);
    }
    host.appendChild(link);
  });
}

// Replace these placeholder paths, titles, subtitles, and links with favorite books.
const favoriteBooks = [
  { title: "The Martian Chronicles", subtitle: "Ray Bradbury", cover: "assets/bradbury.png", link: "https://www.goodreads.com/book/show/76778.The_Martian_Chronicles" },
  { title: "Hard Boiled Wonderland and the End of the World", subtitle: "Haruki Murakami", cover: "assets/murakami.png", link: "https://www.goodreads.com/book/show/12345.Hard_Boiled_Wonderland_and_the_End_of_the_World" },
  { title: "Kindred", subtitle: "Octavia E. Butler", cover: "assets/butler.png", link: "https://www.goodreads.com/book/show/60931.Kindred" },
];

const LASTFM_USER = "alywu";
const LASTFM_API_KEY = "32cb6e7e48b46915f1039e61d63f4905";

async function loadListeningNow() {
  try {
    const params = new URLSearchParams({
      method: "user.getrecenttracks",
      user: LASTFM_USER,
      api_key: LASTFM_API_KEY,
      format: "json",
      limit: "6",
    });
    const response = await fetch("https://ws.audioscrobbler.com/2.0/?" + params);
    if (!response.ok) throw new Error("Last.fm is unavailable right now");
    const data = await response.json();
    const tracks = data?.recenttracks?.track || [];
    const albums = tracks.map((track) => ({
      title: track.name || "Unknown track",
      subtitle: track.artist?.name || "Unknown artist",
      cover: track.image?.at(-1)?.["#text"] || "",
      link: track.url || "https://music.apple.com/profile/alywu",
    }));
    renderMediaItems("listeningNow", albums, "No recent listening history found.", false);
  } catch (error) {
    renderMediaItems("listeningNow", [], "Listening history is unavailable right now. Visit Apple Music to listen with me.");
    console.info("[lastfm]", error.message);
  }
}

loadListeningNow();
renderMediaItems("favoriteBooks", favoriteBooks, "Add your favorite books here.");
