// The app's own page addresses, with ids from the server encoded so none can change the path.

export const cardPath = (id: string) => `/cards/${encodeURIComponent(id)}`;
export const groupPath = (id: number) => `/groups/${id}`;
