// randomphotolink.js
import crypto from 'crypto';

const photoLinks = [
  "https://i.pinimg.com/736x/d6/18/d0/d618d0856d3fdb1f225842524436cc54.jpg",
  "https://i.pinimg.com/736x/e7/99/a1/e799a1441a737d98e15e04f8e63659e7.jpg",
  "https://i.pinimg.com/736x/07/04/33/070433a088eaffc6d949d8efaf905ee7.jpg",
  "https://i.pinimg.com/474x/ef/fb/6e/effb6e1fc55784c4087df4718cd40b35.jpg",
  "https://i.pinimg.com/736x/5c/4c/04/5c4c0477bd800e47979102c5feb7895d.jpg",
  "https://i.pinimg.com/736x/6f/9f/73/6f9f7375ffb87b223628bea061585277.jpg",
  "https://i.pinimg.com/736x/24/58/ca/2458ca42d80ad28dc46d93ab56f4e75e.jpg",
  "https://i.pinimg.com/564x/0a/12/89/0a1289dd3d42d579e28b5206f4dfea5c.jpg",
  "https://i.pinimg.com/736x/4b/76/d7/4b76d75af8360c4d5c2f9c511f61c203.jpg",
  "https://i.pinimg.com/736x/00/7d/56/007d564959560a10692c6b58f01a6221.jpg",
  "https://i.pinimg.com/736x/fb/65/4b/fb654bfa64297e3d8e00103830b26a39.jpg",
  "https://i.pinimg.com/736x/ba/15/02/ba15020906ffdf75fd364d5457a587f2.jpg",
  "https://i.pinimg.com/564x/51/54/c7/5154c70c9041ba07781e4d664b371ff3.jpg",
  "https://i.pinimg.com/564x/79/64/e7/7964e79ffd25303300e0ba2adddedca0.jpg",
  "https://i.pinimg.com/736x/1b/91/80/1b91809196a5195d082069c6bfab449a.jpg"
];

// Better randomness using crypto.randomInt (no modulo bias)
function getRandomPhoto() {
  const index = crypto.randomInt(0, photoLinks.length);
  return photoLinks[index];
}

export { getRandomPhoto };