#!/usr/bin/env node

/* global require */

const prog = require("caporal");
const _ = require("lodash");
const path = require("path");
const ora = require("ora");
const LatexLogParser = require("./lib/latex-log-parser").entry();
const os = require("os");
const watch = require("watch");
const debug = require("debug")("jslatex");
const clipboardy = require("clipboardy");
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
    } else return chalk.yellow(v);
  }
};

let msg = (level, string) => {
  let marker = ">>>";
  if (level === "error") {
    marker = chalk.red.bold(marker);
  } else {
    marker = chalk.blue(marker);
  }
  console.log(`${marker} ${string}`);
};

let reportLog = (l, options) => {
  let errors = _.size(l.errors) * -1;
  let warnings = _.size(l.warnings);
  let citwarnings = _.size(
    _.filter(l.warnings, w => {
      return w.message.includes("Citation");
    })
  );
  let typesetting = _.size(l.typesetting);
  if (!options.silent) {
    console.log("");
    _.map(l.errors, e => {
      msg("error", `${e.file}:${e.line} - ${e.message}$`);
    });
    console.log("");
  }
  if (options.verbose) {
    console.log("");
    _.map(l.errors, e => {
      msg("error", `${e.file}:${e.line} - ${e.message}$`);
    });
    _.map(l.warnings, e => {
      msg("info", `${e.file}:${e.line} - ${e.message}$`);
    });
    _.map(l.typesetting, e => {
      msg("info", `${e.file}:${e.line} - ${e.message}$`);
    });
  }
  return `[${p(errors * -1)}] errors, [${p(warnings)}] warnings, [${p(
    citwarnings
  )}] citation warnings, [${p(typesetting)}] typesetting`;
};

let { test } = require("shelljs");

let executeCommand = (command, { type, options }) => {
  let s = command;
  if (!options.notrunc) {
    s = _.truncate(command, { length: 50 });
  }
  let spinner = ora(`Executing: ${s}`).start();

  return execP(command)
    .then(({ stdout }) => {
      if (type === "latex") {
        let logEntries = LatexLogParser.parse(stdout, {
          ignoreDuplicates: true
        });
        spinner.succeed(reportLog(logEntries, options));
      } else {
        spinner.succeed();
      }
    })
    .catch(({ stdout, error }) => {
      if (!(!options.strict && type === "bibtex")) {
        let logEntries = LatexLogParser.parse(stdout, {
          ignoreDuplicates: true
        });
        spinner.fail(reportLog(logEntries, options));
        throw error;
      } else {
        spinner.succeed("Bibtex failed but continuing");
      }
    });
};

let existingFile = target => test("-e", target) && test("-f", target);

let compile = (target, latexcmd, latexopts, options) => {
  if (existingFile(target)) {
    let execc = `${latexcmd} ${latexopts} '${target}'`;
    let basename = path.basename(target, ".tex");
    let exebib = `bibtex '${basename}'`;
    let filelist = _.map(
      [
        ".aux",
        ".log",
        ".blg",
        ".bbl",
        ".out",
        ".pyg",
        ".toc",
        ".snm",
        ".nav",
        ".*.vrb"
      ],
      x => `${basename}${x}`
    );
    filelist = filelist.concat([`_minted-${basename}`]);
    let execrm = `rm -rf ${_.join(filelist, " ")}`;
    clipboardy.writeSync(execc);
    return executeCommand(execrm, { type: "remove", options })
      .then(() => {
        return executeCommand(execc, { type: "latex", options });
      })
      .then(() => {
        if (!options.nobibtex) {
          return executeCommand(exebib, { type: "bibtex", options })
            .then(() => executeCommand(execc, { type: "latex", options }))
            .then(() => executeCommand(execc, { type: "latex", options }));
        }
      })
      .then(() => {
        if (options.open) {
          const ot = os.type();
          if (ot === "Darwin") {
            return executeCommand(`open '${basename}.pdf'`, {
              type: "open",
              options
            });
          } else {
            if (ot === "Linux") {
              return executeCommand(`xdg-open '${basename}.pdf'`, {
                type: "open",
                options
              });
            } else {
              console.log(`Can't open pdfs on ${ot}.`);
            }
          }
        }
      })
      .finally(() => executeCommand(execrm, { type: "remove", options }));
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
  .option("--strict", "Exit when commands return codes != 0")
  .option("--open", "Open pdf file when generated")
  .option("--watch", "Watch for latex files created")
  .option("--notrunc", "Dont truncate command line output")
  .option("--silent", "Suppress errors")
  .option("--verbose", "Show all warnings and errors")
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
      } else {
        if (args.target === ".") {
          let targetDir;
          targetDir = process.cwd();
          watch.createMonitor(targetDir, { ignoreDotFiles: true }, function(
            monitor
          ) {
            console.log(`Watching for ${targetDir}`);
            monitor.on("changed", function(f) {
              debug(f);
              if (path.extname(f) === ".tex") {
                console.log(`Recompiling because ${f} changed`);
                compile(f, args.cmd, args.opts, options).catch(() => {});
              }
            });
          });
        }
      }
    }
  });

prog.parse(process.argv);
