export async function loadView(pathname: string) {
  if (pathname === "/board" || pathname === "/board/") return (await import("./board/Board")).Board;
  return (await import("./App")).App;
}
