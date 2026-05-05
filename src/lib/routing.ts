export function getAppPath() {
  const search = window.location.search;
  if (search.startsWith('?/')) {
    const path = search.slice(1).split('&')[0];
    return path.startsWith('/') ? path : `/${path}`;
  }

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const pathname = window.location.pathname;

  if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
    const stripped = pathname.slice(basePath.length);
    return stripped.startsWith('/') ? stripped : `/${stripped || ''}`;
  }

  return pathname;
}

export function isHostPath(appPath = getAppPath()) {
  return appPath === '/host' || appPath.startsWith('/host/');
}

export function isDisplayPath(appPath = getAppPath()) {
  return appPath === '/display' || appPath.startsWith('/display/');
}
