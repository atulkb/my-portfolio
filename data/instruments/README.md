# Instrument master list — development snapshot

Raw exchange ticker lists used to build the instrument master list during development (HLD §15).
Downloaded 2026-10-16. **Not live data** — in production a scheduled Cloud Function refreshes the list (later release).

> **The raw files are not in git** (`data/instruments/snapshot-*/` is git-ignored) because exchange data must not be redistributed from a public repository. Download them locally into `data/instruments/snapshot-<YYYY-MM-DD>/` from the sources below; a download script will be added with the instrument-sync implementation. NSE and BSE need a browser-like `User-Agent` header (BSE also a `Referer: https://www.bseindia.com/`).

| File                                              | Source                                                                                                   | Rows                        | Key columns                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `snapshot-2026-10-15/nse_equity_list.csv`         | NSE archives `content/equities/EQUITY_L.csv`                                                             | 2,605                       | `SYMBOL`, `NAME OF COMPANY`, `SERIES`, `ISIN NUMBER`                                                                     |
| `snapshot-2026-10-15/bse_bhavcopy_2026-10-15.csv` | BSE daily equity bhavcopy (UDiFF) `download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_<YYYYMMDD>_F_0000.CSV` | 5,048 (`FinInstrmTp = STK`) | `FinInstrmId` (scrip code, e.g. 500325), `TckrSymb`, `ISIN`, `FinInstrmNm`, `SctySrs`                                    |
| `snapshot-2026-10-15/us_nasdaqlisted.txt`         | Nasdaq Trader `dynamic/SymDir/nasdaqlisted.txt` (pipe-delimited)                                         | 5,632                       | `Symbol`, `Security Name`, `ETF`, `Test Issue`                                                                           |
| `snapshot-2026-10-15/us_otherlisted.txt`          | Nasdaq Trader `dynamic/SymDir/otherlisted.txt` (pipe-delimited)                                          | 7,674                       | `ACT Symbol`, `Security Name`, `Exchange` (N=NYSE, A=NYSE American, P=NYSE Arca, Z=Cboe BZX, V=IEX), `ETF`, `Test Issue` |

## Notes

- BSE's "List of Scrips" API blocks scripted downloads (HTTP 403), so the BSE daily bhavcopy is used instead. It only contains scrips that traded that day — fine for a holdings app; illiquid untraded scrips can be added manually.
- 2,423 companies appear on both NSE and BSE (matched by ISIN) → merged into one instrument with two listings. 2,625 are BSE-only.
- Drop rows with `Test Issue = Y` and the trailing `File Creation Time` line in Nasdaq Trader files.
- For personal/development use. Check each exchange's terms before redistributing in a public app.
