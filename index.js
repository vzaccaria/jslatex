#!/usr/bin/env node

const prog = require("caporal");
const _ = require("lodash");
const path = require("path");
const ora = require("ora");
const LatexLogParser = require("./lib/latex-log-parser").entry();
const os = require("os");
const watch = require("watch");
const debug = require("debug")("jslatex");

const chalk = require("chalk");

let Promise = require("bluebird");
let execP = command => {
  return new Promise((resolve, reject) => {
    require("child_process").exec(command, (error, stdout, stderr) => {
      debug({ error, stdout, stderr });
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ error, stdout, stderr });
      }
    });
  });
};

let p = v => {
  if (v < 0) {
    return chalk.red(v);
  } else {
    if (v === 0) {
      return chalk.green(v);
    } else
      return chalk.yellow(v);
  }
};

let reportLog = l => {
  let errors = _.size(l.errors) * (-1);
  let warnings = _.size(l.warnings);
  let citwarnings = _.size(
    _.filter(l.warnings, w => {
      return w.message.includes("Citation");
    })
  );
  let typesetting = _.size(l.typesetting);
  return `[${p(errors)}] errors, [${p(warnings)}] warnings, [${p(
    citwarnings
  )}] citation warnings, [${p(typesetting)}] typesetting`;
};

let { test } = require("shelljs");

let executeCommand = (command, { type, options }) => {
  let spinner = ora(`Executing: ${command}`).start();
  return execP(command)
    .then(({ stdout }) => {
      if (type === "latex") {
        let logEntries = LatexLogParser.parse(stdout, {
          ignoreDuplicates: true
        });
        spinner.succeed(reportLog(logEntries));
      } else {
        spinner.succeed();
      }
    })
    .catch(err => {
      if (!(options.force && type === "bibtex")) {
        spinner.fail(`Command failed with code: ${err.error.code}`);
        throw err;
      } else {
        spinner.succeed("Bibtex failed but continuing");
      }
    });
};

let existingFile = target => test("-e", target) && test("-f", target);

let compile = (target, latexcmd, latexopts, options) => {
  if (existingFile(target)) {
    let execc = `${latexcmd} ${latexopts} ${target}`;
    let basename = path.basename(target, ".tex");
    let exebib = `bibtex ${basename}`;
    let filelist = _.map(
      [".aux", ".log", ".blg", ".bbl", ".out"],
      x => `${basename}${x}`
    );
    let execrm = `rm -f ${_.join(filelist, " ")}`;
    return executeCommand(execc, { type: "latex", options })
      .then(() => {
        if (!options.nobibtex) {
          return executeCommand(exebib, { type: "bibtex", options })
            .then(() => executeCommand(execc, { type: "latex", options }))
            .then(() => executeCommand(execc, { type: "latex", options }));
        }
      })
      .then(() => executeCommand(execrm, { type: "remove", options }))
      .then(() => {
        if (options.open) {
          const ot = os.type();
          if (ot === "Darwin") {
            return executeCommand(`open ${basename}.pdf`, {
              type: "open",
              options
            });
          } else {
            if (ot === "Linux") {
              return executeCommand(`xdg-open ${basename}.pdf`, {
                type: "open",
                options
              });
            } else {
              console.log(`Can't open pdfs on ${ot}.`);
            }
          }
        }
      });
  }
};

prog
  .version("1.0.0")
  .description("Compiles latex")
  .argument("<target>", "Top level file or directory")
  .argument("[cmd]", "Compile command", _.identity, "pdflatex")
  .argument(
    "[opts]",
    "Options passed to the compiler",
    _.identity,
    "-shell-escape -halt-on-error"
  )
  .option("--nobibtex", "Dont run bibtex")
  .option("--force", "Force even if commands return codes != 0")
  .option("--open", "Open pdf file when generated")
  .option("--watch", "Watch for latex files created")
  .action(function(args, options) {
    if (!options.watch) {
      compile(args.target, args.cmd, args.opts, options).catch(() => {});
    } else {
      if (existingFile(args.target)) {
        let targetDir;
        let target = args.target;
        let absoluteTargetPath;
        if (!path.isAbsolute(target)) {
          targetDir = path.resolve(process.cwd(), path.dirname(target));
          absoluteTargetPath = path.resolve(process.cwd(), target);
        } else {
          targetDir = path.dirname(target);
          absoluteTargetPath = target;
        }

        watch.createMonitor(targetDir, { ignoreDotFiles: true }, function(
          monitor
        ) {
          console.log(`Watching for ${targetDir}`);
          monitor.files[absoluteTargetPath];
          monitor.on("changed", function(f) {
            if (
              f === absoluteTargetPath ||
              path.extname(f) === ".tex" ||
              path.extname(f) === ".bib"
            ) {
              console.log(`Recompiling because ${f} changed`);
              compile(args.target, args.cmd, args.opts, options)
                .catch(() => {})
                .then(() => {
                  if (options.open) {
                    options.open = false;
                  }
                });
            }
          });
        });
      }
    }
  });

prog.parse(process.argv);
