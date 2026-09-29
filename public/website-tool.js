const SITE_URLS = {
  github: "https://github.com",
  youtube: "https://youtube.com",
  assemblyai: "https://www.assemblyai.com/docs",
  gmail: "https://mail.google.com",
  calendar: "https://calendar.google.com",
};

export function openWebsite(site) {
  const url = SITE_URLS[site];

  if (!url) {
    return {
      success: false,
      error: `Unsupported website: ${site}`,
    };
  }

  try {
    console.log(`Opening ${site}:`, url);

    const openedWindow = window.open(url, "_blank");

    if (!openedWindow) {
      throw new Error("The browser blocked the new tab.");
    }

    return {
      success: true,
      site,
      url,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}
