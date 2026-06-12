declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare const opentype: any;

declare global {
  interface Window {
    PtRender: any;
  }

  var PtRender: any;
}

export {};
