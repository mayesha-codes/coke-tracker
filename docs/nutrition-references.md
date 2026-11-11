# Reviewed nutrition references

SipShift uses a small source-reviewed list for personal consumption estimates. A
review means the transcribed values were checked against the identified source;
it is not a manufacturer endorsement, laboratory analysis, or guarantee that every
package carrying a similar name has the same recipe. Select the market that
matches the actual product. Currency and reporting timezone do not select a market.

## Coca-Cola Original Taste — Great Britain

| Field | Recorded evidence |
| --- | --- |
| Reference ID | `coca-cola-original-taste-gb` |
| Reference version | `1` |
| Product key | `coca-cola-original-taste` |
| Product | Coca-Cola Original Taste |
| Market | Great Britain (`GB`) |
| Evidence type | Manufacturer product page |
| Source | [Coca-Cola Great Britain](https://www.coca-cola.com/gb/en/brands/coca-cola-original-taste) |
| Source location | Products → Coca-Cola Original Taste → Nutrition; the Original Taste section, before Lime/Cherry/Lemon |
| Review date | 2026-11-11 |
| Original basis | Per 100 ml |
| Explicit sugar field | Of which sugars: **10.6 g** |
| Energy field | **42 kcal** (the source also reports 180 kJ; SipShift uses the stated kcal value) |
| Normalized sugar | 10.6 g per 100 ml |
| Normalized energy | 42 kcal per 100 ml |

The page separately lists carbohydrates. The sugar rate above comes from its
explicit sugar field, not from treating carbohydrates as sugars. No unit
conversion is needed for this record because the source already reports per
100 ml. As an arithmetic check, two 330 ml servings give 660 ml, 69.96 g estimated
sugar, and 277.2 kcal. Calculations retain fractional estimates; display rounding
is separate. These are estimates from published, potentially rounded label values.

## Maintaining versions

- Recheck the specific source section before adding or changing reviewed data.
- Keep a stable ID for the same product and market. A different market has a
  different ID, even when the product name or numeric values match.
- Append a new reference/evidence version for changed nutrition or source details;
  retain earlier records unchanged. Only the highest version is offered for a new
  selection. An unfinished draft keeps its copied selected version until explicit
  adoption, and historical drinks keep their original snapshots and provenance.
- Do not mark a product reviewed when the source gives only carbohydrates, lacks
  an explicit sugar value, or leaves the energy units/basis ambiguous. Obtain
  clearer manufacturer or package-label evidence instead.
- This first checkpoint accepts source measurements already expressed per 100 ml,
  in grams of sugars and kcal. Other bases require a separately reviewed conversion
  change and tests; the validator never silently converts kJ, grams, or servings.
- Manufacturer-page evidence requires an HTTP/HTTPS URL matching the reference's
  saved source URL. Package-label evidence requires an identified archived image
  location and section; the archive itself must be reviewed before publication.
  Package images may use an HTTP/HTTPS URL or a repository-relative PNG/JPEG/WebP
  path without directory traversal. Other URI schemes and absolute paths are rejected.
- `reviewedProducts.ts` keeps structured evidence separate from core domain
  references. The core validator intentionally retains only known fields. Product
  and market remain in the copied description; the manufacturer/basis and source
  URL remain in historical source metadata. Full evidence remains in this versioned
  registry and ledger, addressable by ID/version.
- Tests check structure, arithmetic, and consistency. They cannot establish source
  accuracy. Clearly named illustrative test products are injected into tests only
  and are never imported into the production list.

Exactly one production reference is included initially. Personal label values are
separate and remain labeled **User-provided — not independently verified.**
