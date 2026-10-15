// Both files are packaged, manifest-declared MAIN-world document_start scripts.
// Install synchronously, before the page's first script can inspect navigator.xr.
// This world must never receive extension APIs or storage access.
WebXRPolyfillInjection();
new CustomWebXRPolyfill();
export {};
