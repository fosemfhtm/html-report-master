# README 이미지

- `banner.html`: 배너 원본. 2560×1040 창에서 열어 찍는다. `banner.html`은 `docs/banner-light.png`, `banner.html?dark`는 `docs/banner-dark.png`가 된다. 안에 쓰는 그림은 `docs/report-softmax.png`(데모 보고서의 softmax 단계 탭)과 `docs/tf-softmax-*.png`(데모 발표의 softmax 장면)이다.
- 보고서 부품 그림(`docs/C1-10.png` 등): `docs/gallery.html`을 1440px 폭, 배율 1.5로 열고 상단 바를 숨긴 뒤 `#부품ID` 섹션을 찍어 가로 1100px로 줄인다.
- 발표 장면 그림(`docs/motion-MS-*.png`): `docs/motion.html`을 1920×1080으로 열고 `window.__deck.seekBeat(i)`로 스텝 끝을 찾아 찍은 뒤 1280×720으로 줄인다.
- `docs/motion.gif`: `docs/demo/transformer-motion.html`을 1280×720으로 열고 `window.__deck.seekTime(t)`를 0.08초씩 옮기며 찍는다. 스텝 끝 프레임은 1.8초 보여 준다.
- `docs/demo.gif`: `docs/demo/transformer.html`을 960×600으로 열고 스크롤, 첫 슬라이더, 단계 탭 두 묶음을 차례로 움직이며 찍는다.
