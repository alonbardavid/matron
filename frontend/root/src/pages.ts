/** The app's pages by path, as the navigation and the phone's top bar name them. */
export const PAGE_TITLES: Record<string, string> = {
  "/": "Calendar",
  "/lists": "Lists",
  "/conversations": "Conversations",
  "/builds": "Builds",
  "/users": "Users",
  "/app-settings": "App settings",
  "/troubleshooting": "Troubleshooting",
  "/settings": "Settings",
};

export function pageTitle(pathname: string): string | null {
  if (pathname.startsWith("/lists/")) return PAGE_TITLES["/lists"]!;
  return PAGE_TITLES[pathname] ?? null;
}
