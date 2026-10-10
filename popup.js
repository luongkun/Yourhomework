const D = { auto: true, turbo: false, highlight: true, autoNext: true, delayMin: 500, delayMax: 1400 };
chrome.storage.local.get(D, (v) => {
  auto.checked = !!v.auto; turbo.checked = !!v.turbo; highlight.checked = !!v.highlight; autoNext.checked = !!v.autoNext;
  dmin.value = v.delayMin; dmax.value = v.delayMax;
});
save.onclick = () => {
  chrome.storage.local.set({
    auto: auto.checked, turbo: turbo.checked, highlight: highlight.checked, autoNext: autoNext.checked,
    delayMin: +dmin.value || 0, delayMax: +dmax.value || 800
  });
  save.textContent = 'Đã lưu ✓'; setTimeout(() => save.textContent = 'Lưu', 1200);
};
