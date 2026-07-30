const OrganizationProgramModel = require("../models/orgProgram.model");
const {
  WINNER_HASH,
  ALL_PROGRAMS_NAME,
  PROGRAM_SEQUENCE,
  ORG_CAT_CAPSULE,
  PROGRAM_MODULE_META,
  getOrSetMap,
} = require("../helper/benchmarkData.helper");
const { getMediaFromStorage } = require("../helper/fileStorage");
const { respondWithThemedSampleWorkbook } = require("../helper/sampleWorkbookTheme.helper");

class BenchmarkMiddleware {
  constructor() {
    this.generateOrgCats = this.generateOrgCats.bind(this);
  }

  async generateOrgCats(req, res, next) {
    try {
      if (req.query.isDummy && req.path == "/v2/generateBenchmarkReport") {
        const themedSample = await respondWithThemedSampleWorkbook(res, {
          key: "Benchmark_Comparison_Report_SAMPLE.xlsx",
          fileName: "Benchmark_Comparison_Report_SAMPLE.xlsx",
        });
        if (themedSample) return themedSample;

        let data = await getMediaFromStorage({
          key: "Benchmark_Comparison_Report_SAMPLE.xlsx",
          awsBucket: "sample-report-files",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        } else {
          console.log(data, "error in generateOrgCats");
          return res
            .status(500)
            .send({ success: false, message: "something went wrong" });
        }
      } else if (
        req.query.isDummy &&
        req.path == "/employerBenchmarkReportExcel"
      ) {
        const themedSample = await respondWithThemedSampleWorkbook(res, {
          key: "Benefits_Best_Practices_SAMPLE.xlsx",
          fileName: "Benefits_Best_Practices_SAMPLE.xlsx",
        });
        if (themedSample) return themedSample;

        let data = await getMediaFromStorage({
          key: "Benefits_Best_Practices_SAMPLE.xlsx",
          awsBucket: "sample-report-files",
        });
        if (data.success) {
          return res.json({ success: true, message: "success", data });
        } else {
          console.log(data, "error in generateOrgCats");
          return res
            .status(500)
            .send({ success: false, message: "something went wrong" });
        }
      }
      let orgPrograms = await OrganizationProgramModel.find({
        programId: req.program._id,
      });

      const categorizedOrgsMap = new Map();
      const winnerKeys = Object.keys(WINNER_HASH);
      let programModuleHash = PROGRAM_MODULE_META(req.program);
      orgPrograms.forEach(
        ({
          Current_Year_Category: orgSize,
          Current_Year_Winner: winner,
          Deal_Organization_ID,
        }) => {
          const programModule = programModuleHash[orgSize || null];
          if (programModule && winner) {
            const { orgSizeName, orgSizeQuantity } = programModule;
            const catCapsule = getOrSetMap(
              categorizedOrgsMap,
              orgSizeName,
              () =>
                winnerKeys.map((winner) =>
                  ORG_CAT_CAPSULE(orgSize, winner, orgSizeQuantity, req)
                )
            );
            catCapsule[WINNER_HASH[winner]].ids.push(
              Deal_Organization_ID.toString()
            );
          }
        }
      );

      let breakouts = PROGRAM_SEQUENCE.reduce((arr, orgSizeName) => {
        const catCapsule = categorizedOrgsMap.get(orgSizeName);
        if (!catCapsule) {
          return arr;
        }
        return arr.concat(catCapsule);
      }, []);
      if (breakouts.length === 0) {
        breakouts = Array.from(categorizedOrgsMap.values()).flat();
      }

      const xSymbol = "x";
      const filteredBreakouts = breakouts.filter((breakout) => {
        if (breakout.ids.length < 5) {
          breakout.isOrgHidden = xSymbol;
          return false;
        }
        return true;
      });
      const allOrgCats = winnerKeys.map((winner) => {
        const allOrgCat = ORG_CAT_CAPSULE(ALL_PROGRAMS_NAME, winner, "", req);
        allOrgCat.breakouts = [];
        breakouts.forEach((breakout) => {
          if (breakout.winner === winner) {
            allOrgCat.ids = allOrgCat.ids.concat(breakout.ids);
            allOrgCat.breakouts.push(breakout);
          }
        });
        if (allOrgCat.ids.length < 5)
          allOrgCat.isOrgHidden = xSymbol;
        return allOrgCat;
      });

      req.benchmarkAllOrgCats = allOrgCats;
      req.benchmarkFilteredBreakouts = filteredBreakouts;
      req.benchmarkBreakouts = breakouts;
      req.benchmarkDisplayHeader = [
        ...allOrgCats,
        ...breakouts.filter(({ orgSize }) => orgSize),
      ];
      next();
    } catch (e) {
      console.log(e, "error in generateOrgCats");
      res.status(500).send({ success: false, message: "something went wrong" });
    }
  }
}

module.exports = new BenchmarkMiddleware();
