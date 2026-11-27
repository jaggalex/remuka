/** The URL is only a navigation hint. Room APIs still authorise every action. */
export function homeAction(panel: string) {
  const params = new URLSearchParams(window.location.search);
  return params.get("homeAction") === panel ? params.get("target") ?? "open" : null;
}

