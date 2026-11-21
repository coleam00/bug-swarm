export async function loadView(pathname: string) {
  if (pathname === "/board" || pathname === "/board/") return (await import("./board/Board")).Board;
  if (pathname === "/arena" || pathname === "/arena/") {
    history.replaceState(history.state, "", "/" + window.location.search + window.location.hash);
  }
  return (await import("./arena/Arena")).Arena;
}
