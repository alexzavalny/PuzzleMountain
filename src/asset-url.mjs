function defaultBaseUrl() {
  if (typeof window !== "undefined" && window.location) {
    return new URL(".", window.location.href);
  }

  return new URL("http://localhost/");
}

export function assetUrl(relativePath, baseUrl = defaultBaseUrl()) {
  return new URL(relativePath, baseUrl).toString();
}
