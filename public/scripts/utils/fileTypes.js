const TEXT_EXT = new Set(["js","jsx","ts","tsx","json","jsonc","md","markdown","txt","css","scss","html","htm","xml","yml","yaml","toml","ini","env","sh","bash","py","rb","go","rs","c","h","cpp","hpp","java","kt","swift","php","sql","graphql","vue","svelte","lock","gitignore","gitattributes","editorconfig","csv","log"]);
const IMAGE_EXT = new Set(["png","jpg","jpeg","gif","webp","svg","bmp","ico"]);

export function extOf(path) {
  const base = path.split("/").pop();
  if (base.startsWith(".") && !base.includes(".", 1)) return base.slice(1).toLowerCase(); // dotfiles like .gitignore
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1).toLowerCase();
}
export function isTextFile(path) { return TEXT_EXT.has(extOf(path)); }
export function isImageFile(path) { return IMAGE_EXT.has(extOf(path)); }
