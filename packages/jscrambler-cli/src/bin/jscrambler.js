#!/usr/bin/env node

import commander from 'commander';
import defaults from 'lodash.defaults';
import glob from 'glob';
import path from 'path';
import filesizeParser from 'filesize-parser';

import _config from '../config';
import jscrambler from '../';
import {mergeAndParseParams} from '../cli';

const debug = !!process.env.DEBUG;
const validateBool = option => val => {
  if (!/^(true|false)$/i.test(val)) {
    console.error(`*${option}* requires a <bool> value.`);
    process.exit(1);
  }
  return val.toLowerCase();
};

const validateCodeHardeningThreshold = val => {
  let inBytes;
  try {
    inBytes = filesizeParser(val);
  } catch (e) {
    console.error(
      '*code-hardening-threshold* requires a valid <threshold> value. Format: {number}{unit="b,kb,mb"}. Example: --code-hardening-threshold 200kb'
    );
    process.exit(1);
  }
  return inBytes;
};

commander
  .version(require('../../package.json').version)
  .usage('[options] <file ...>')
  .option('-a, --access-key <accessKey>', 'Access key')
  .option('-c, --config <config>', 'Jscrambler configuration options')
  .option('-H, --host <host>', 'Hostname')
  .option('-i, --application-id <id>', 'Application ID')
  .option('-o, --output-dir <dir>', 'Output directory')
  .option('-p, --port <port>', 'Port')
  .option('--protocol <protocol>', 'Protocol (http or https)')
  .option('--cafile <path>', 'Internal certificate authority')
  .option('-C, --cwd <dir>', 'Current Working Directory')
  .option('-s, --secret-key <secretKey>', 'Secret key')
  .option('-m, --source-maps <id>', 'Download source maps')
  .option('-R, --randomization-seed <seed>', 'Set randomization seed')
  .option(
    '--code-hardening-threshold <threshold>',
    'Set code hardening file size threshold. Format: {value}{unit="b,kb,mb"}. Example: 200kb',
    validateCodeHardeningThreshold
  )
  .option(
    '--recommended-order <bool>',
    'Use recommended order',
    validateBool('recommended-order')
  )
  .option(
    '-W, --werror <bool>',
    'Set werror flag value (default: true)',
    validateBool('werror')
  )
  .option(
    '--tolerate-minification <bool>',
    `Don't detect minification as malicious tampering (default: true)`,
    validateBool('tolerate-minification')
  )
  .option(
    '--use-profiling-data <bool>',
    `Protection should use the existing profiling data (default: true)`,
    validateBool('use-profiling-data')
  )
  .option('--jscramblerVersion <version>', 'Use a specific Jscrambler version')
  .option('--debugMode', 'Protect in debug mode')
  .parse(process.argv);

let globSrc, filesSrc, config;

// If -c, --config file was provided
if (commander.config) {
  // We're using `commander` (CLI) as the source of all truths, falling back to
  // the `config` provided by the file passed as argument
  config = require(path.resolve(commander.config, '.'));
} else {
  config = {};
}

config.accessKey =
  commander.accessKey || (config.keys ? config.keys.accessKey : undefined);
config.secretKey =
  commander.secretKey || (config.keys ? config.keys.secretKey : undefined);
config.host = commander.host || config.host;
config.port = commander.port || config.port;
config.port = config.port && parseInt(config.port);
config.protocol = commander.protocol || config.protocol;
config.cafile = commander.cafile || config.cafile;
config.filesDest = commander.outputDir || config.filesDest;
config.applicationId = commander.applicationId || config.applicationId;
config.randomizationSeed =
  commander.randomizationSeed || config.randomizationSeed;
config.cwd = commander.cwd || config.cwd;
config.useRecommendedOrder = commander.recommendedOrder
  ? commander.recommendedOrder !== 'false'
  : config.useRecommendedOrder;
config.tolerateMinification = commander.tolerateMinification
  ? commander.tolerateMinification !== 'false'
  : config.tolerateMinification;
config.werror = commander.werror ? commander.werror !== 'false' : config.werror;
config.jscramblerVersion =
  commander.jscramblerVersion || config.jscramblerVersion;
config.debugMode = commander.debugMode || config.debugMode;
// handle codeHardening = 0
if (typeof commander.codeHardeningThreshold === 'undefined') {
  config.codeHardeningThreshold = config.codeHardeningThreshold
    ? validateCodeHardeningThreshold(config.codeHardeningThreshold)
    : undefined;
} else {
  config.codeHardeningThreshold = commander.codeHardeningThreshold;
}

if (commander.useProfilingData) {
  config.useProfilingData = commander.useProfilingData !== 'false';
}

if (config.jscramblerVersion && !/^(?:\d+\.\d+(?:-f)?|stable|latest)$/.test(config.jscramblerVersion)) {
  console.error(
    'The Jscrambler version must be in the form of $major.$minor or the words stable and latest. (e.g. 5.2, stable, latest)'
  );
  process.exit(1);
}

config = defaults(config, _config);

globSrc = config.filesSrc;
// If src paths have been provided
if (commander.args.length > 0) {
  globSrc = commander.args;
}

if (globSrc && globSrc.length) {
  filesSrc = [];
  // Iterate `globSrc` to build a list of source files into `filesSrc`
  for (let i = 0, l = globSrc.length; i < l; i += 1) {
    // Calling sync `glob` because async is pointless for the CLI use case
    // (as of now at least)

    // If the user is providing a zip alongside more files
    if (path.extname(globSrc[i]) === '.zip' && globSrc.length > 1) {
      console.error(
        'Please provide either a zip file containing all your source files or use the minimatch syntax'
      );
      process.exit(1);
    }

    const tmpGlob = glob.sync(globSrc[i], {
      dot: true
    });

    if (config.werror && tmpGlob.length === 0) {
      console.error(`Pattern "${globSrc[i]}" doesn't match any files.`);
      process.exit(1);
    }

    if (debug) {
      if (tmpGlob.length === 0) {
        console.log(
          `Pattern "${globSrc[i]}" doesn't match any files. Will be ignored.`
        );
      } else {
        console.log(`Pattern "${globSrc[i]}" matched the following files:`);
        tmpGlob.forEach(file => {
          console.log(`    ${file}`);
        });
      }
    }
    filesSrc = filesSrc.concat(tmpGlob);
  }
  if (filesSrc.length === 0) {
    console.error('No files matched.');
    process.exit(1);
  }
} else if (debug) {
  console.log(
    'No filesSrc provided. Using the ones in the application (if any).'
  );
}

const {
  applicationId,
  accessKey,
  secretKey,
  filesDest,
  host,
  port,
  protocol,
  cafile,
  applicationTypes,
  languageSpecifications,
  areSubscribersOrdered,
  cwd,
  randomizationSeed,
  sourceMaps = false,
  useRecommendedOrder,
  werror,
  tolerateMinification,
  jscramblerVersion,
  debugMode,
  proxy,
  codeHardeningThreshold,
  useProfilingData
} = config;

const params = mergeAndParseParams(commander, config.params);

if (commander.sourceMaps) {
  // Go, go, go download
  (async () => {
    try {
      await jscrambler.downloadSourceMaps({
        keys: {
          accessKey,
          secretKey
        },
        host,
        port,
        protocol,
        cafile,
        filesDest,
        filesSrc,
        protectionId: commander.sourceMaps
      });
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  })();
} else {
  // Go, go, go
  (async () => {
    const protectAndDownloadOptions = {
      keys: {
        accessKey,
        secretKey
      },
      host,
      port,
      protocol,
      cafile,
      applicationId,
      filesSrc,
      filesDest,
      params,
      applicationTypes,
      languageSpecifications,
      areSubscribersOrdered,
      cwd,
      sourceMaps,
      randomizationSeed,
      useRecommendedOrder,
      tolerateMinification,
      jscramblerVersion,
      debugMode,
      proxy,
      codeHardeningThreshold,
      useProfilingData
    };
    try {
      if (typeof werror !== 'undefined') {
        protectAndDownloadOptions.bail = werror;
      }
      await jscrambler.protectAndDownload(protectAndDownloadOptions);
    } catch (error) {
      console.error(debug ? error : error.message || error);
      process.exit(1);
    }
  })();
}
