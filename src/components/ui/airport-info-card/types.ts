export type MetarData = {
  rawOb?: string;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: number | string;
  altim?: number;
  clouds?: { cover: string; base?: number }[];
  fltcat?: string;
  name?: string;
};

export type TafData = {
  rawTAF?: string;
  issueTime?: string;
  validTimeFrom?: number;
  validTimeTo?: number;
};

export type AirportPhoto = {
  imageUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  pageUrl: string;
  pageTitle: string;
  description: string | null;
};
