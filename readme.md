# Survey Plan Closure Assistant

A browser-based assistant for capturing traverse dimensions from survey plan PDFs or images, confirming each leg, and calculating closure and area.

This project builds on the calculation logic used in Traverse Calculator v2. The calculation engine is kept in `traverse-engine.js` so the OCR workflow does not replace or alter the core traverse mathematics.

## What this first version does

- Uploads multi-page PDF plans, PNGs, JPEGs and WebP images.
- Creates page thumbnails and provides previous, next and page-selection controls.
- Renders a selected PDF page as a high-resolution image.
- Lets the user drag a box around one bearing, distance, arc, radius or curve direction.
- Uses cropped-region OCR rather than trying to interpret the entire plan.
- Provides text-rotation controls for plan labels that are not horizontal.
- Normalizes common bearing formats to `D.MMSS` for review.
- Requires the user to confirm each leg.
- Supports straight and curved traverse segments.
- Calculates coordinates, misclosure, error of closure and area.
- Draws straight segments and curves, with curve chords shown in orange.
- Prints a compact calculation report.

## Recommended workflow

1. Upload the complete survey plan PDF.
2. Select the sheet or page being reviewed.
3. Select the current traverse leg in the table.
4. Choose Bearing, Distance / Arc, Radius or Curve Direction.
5. Drag a tight box around only that value on the plan.
6. Adjust the text rotation if required.
7. Select **Read Selected Text**.
8. Review or correct the recognized value.
9. Apply the value to the selected leg.
10. Confirm the leg and continue around the boundary.
11. Calculate the closure and area after all legs are confirmed.

## Publish with GitHub Pages

1. Create a new GitHub repository.
2. Upload all files from this project to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.

The site will be available at:

`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY-NAME/`

## Internet connection

The application uses PDF.js and Tesseract.js from public content-delivery networks. The first OCR operation may take longer while the OCR language files are downloaded. The uploaded plan itself is processed in the browser and is not sent to an application server by this code.

## Important limitations

- OCR is an aid and may misread dimensions, especially on faint, crowded or low-resolution plans.
- Text at arbitrary rotations may require manual rotation adjustment and a second OCR attempt.
- The software does not determine which dimension belongs to a boundary automatically; the user selects each value.
- Every OCR result and calculated value must be checked against the filed plan before professional use.
- This is not a substitute for professional judgment or an independent calculation check.

## Files

- `index.html` — user interface and third-party library references
- `styles.css` — screen and print layout
- `app.js` — PDF/image viewing, selection, OCR and leg-confirmation workflow
- `traverse-engine.js` — D.MMSS parsing, straight/curve traverse calculations, reporting and plotting
