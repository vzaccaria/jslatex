#!/usr/bin/env node

const prog = require("caporal");
const _ = require("lodash");
const path = require("path");
const ora = require("ora");
const LatexLogParser = require("./lib/latex-log-parser").entry();

const chalk = require("chalk");

let Promise = require("bluebird");
let execP = command => {
  return new Promise((resolve, reject) => {
    require("child_process").exec(command, (error, stdout, stderr) => {
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

let executeCommand = (command, type) => {
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
      spinner.fail(`Command failed with code: ${err.error.code}`);
      throw err;
    });
};

let compile = (target, cmd, opts) => {
  if (test("-e", target) && test("-f", target)) {
    let execc = `${cmd} ${opts} ${target}`;
    let basename = path.basename(target, ".tex");
    let exebib = `bibtex ${basename}`;
    let filelist = _.map(
      [".aux", ".log", ".blg", ".bbl"],
      x => `${basename}${x}`
    );
    let execrm = `rm -f ${_.join(filelist, " ")}`;
    return executeCommand(execc, "latex")
      .then(() => executeCommand(exebib))
      .then(() => executeCommand(execc, "latex"))
      .then(() => executeCommand(execc, "latex"))
      .then(() => executeCommand(execrm));
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
  .option("--open", "Open pdf file when generated")
  .option("--watch", "Watch for latex files created")
  .action(function(args, options, logger) {
    compile(args.target, args.cmd, args.opts, logger).catch(() => {});
  });

prog.parse(process.argv);
