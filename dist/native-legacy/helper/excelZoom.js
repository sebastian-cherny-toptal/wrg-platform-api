function applyWorksheetZoom(worksheet, zoomScale = 75) {
  if (!worksheet) return;

  const existingViews = Array.isArray(worksheet.views) ? worksheet.views : [];
  if (existingViews.length === 0) {
    worksheet.views = [{ state: "normal", zoomScale }];
    return;
  }

  worksheet.views = existingViews.map((view) => ({
    ...view,
    zoomScale,
  }));
}

module.exports = {
  applyWorksheetZoom,
};
