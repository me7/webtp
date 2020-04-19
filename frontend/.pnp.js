#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["sirv-cli", new Map([
    ["0.4.5", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-sirv-cli-0.4.5-fecdfdd943000797f79c6652a1ce272cdb8df369-integrity/node_modules/sirv-cli/"),
      packageDependencies: new Map([
        ["console-clear", "1.1.1"],
        ["get-port", "3.2.0"],
        ["kleur", "3.0.3"],
        ["local-access", "1.0.1"],
        ["sade", "1.7.3"],
        ["sirv", "0.4.2"],
        ["tinydate", "1.2.0"],
        ["sirv-cli", "0.4.5"],
      ]),
    }],
  ])],
  ["console-clear", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-console-clear-1.1.1-995e20cbfbf14dd792b672cde387bd128d674bf7-integrity/node_modules/console-clear/"),
      packageDependencies: new Map([
        ["console-clear", "1.1.1"],
      ]),
    }],
  ])],
  ["get-port", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-get-port-3.2.0-dd7ce7de187c06c8bf353796ac71e099f0980ebc-integrity/node_modules/get-port/"),
      packageDependencies: new Map([
        ["get-port", "3.2.0"],
      ]),
    }],
  ])],
  ["kleur", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-kleur-3.0.3-a79c9ecc86ee1ce3fa6206d1216c501f147fc07e-integrity/node_modules/kleur/"),
      packageDependencies: new Map([
        ["kleur", "3.0.3"],
      ]),
    }],
  ])],
  ["local-access", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-local-access-1.0.1-5121258146d64e869046c642ea4f1dd39ff942bb-integrity/node_modules/local-access/"),
      packageDependencies: new Map([
        ["local-access", "1.0.1"],
      ]),
    }],
  ])],
  ["sade", new Map([
    ["1.7.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-sade-1.7.3-a217ccc4fb4abb2d271648bf48f6628b2636fa1b-integrity/node_modules/sade/"),
      packageDependencies: new Map([
        ["mri", "1.1.5"],
        ["sade", "1.7.3"],
      ]),
    }],
  ])],
  ["mri", new Map([
    ["1.1.5", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-mri-1.1.5-ce21dba2c69f74a9b7cf8a1ec62307e089e223e0-integrity/node_modules/mri/"),
      packageDependencies: new Map([
        ["mri", "1.1.5"],
      ]),
    }],
  ])],
  ["sirv", new Map([
    ["0.4.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-sirv-0.4.2-842ed22f3aab58faee84eea66cf66066e123d6db-integrity/node_modules/sirv/"),
      packageDependencies: new Map([
        ["@polka/url", "0.5.0"],
        ["mime", "2.4.4"],
        ["sirv", "0.4.2"],
      ]),
    }],
  ])],
  ["@polka/url", new Map([
    ["0.5.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@polka-url-0.5.0-b21510597fd601e5d7c95008b76bf0d254ebfd31-integrity/node_modules/@polka/url/"),
      packageDependencies: new Map([
        ["@polka/url", "0.5.0"],
      ]),
    }],
  ])],
  ["mime", new Map([
    ["2.4.4", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-mime-2.4.4-bd7b91135fc6b01cde3e9bae33d659b63d8857e5-integrity/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "2.4.4"],
      ]),
    }],
  ])],
  ["tinydate", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-tinydate-1.2.0-36b4bb02715f89743f3ef9073d3573d005a28d0e-integrity/node_modules/tinydate/"),
      packageDependencies: new Map([
        ["tinydate", "1.2.0"],
      ]),
    }],
  ])],
  ["@rollup/plugin-commonjs", new Map([
    ["11.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@rollup-plugin-commonjs-11.0.2-837cc6950752327cb90177b608f0928a4e60b582-integrity/node_modules/@rollup/plugin-commonjs/"),
      packageDependencies: new Map([
        ["rollup", "1.32.1"],
        ["@rollup/pluginutils", "pnp:fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086"],
        ["estree-walker", "1.0.1"],
        ["is-reference", "1.1.4"],
        ["magic-string", "0.25.7"],
        ["resolve", "1.16.1"],
        ["@rollup/plugin-commonjs", "11.0.2"],
      ]),
    }],
  ])],
  ["@rollup/pluginutils", new Map([
    ["pnp:fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086/node_modules/@rollup/pluginutils/"),
      packageDependencies: new Map([
        ["rollup", "1.32.1"],
        ["@types/estree", "0.0.39"],
        ["estree-walker", "1.0.1"],
        ["micromatch", "4.0.2"],
        ["@rollup/pluginutils", "pnp:fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086"],
      ]),
    }],
    ["pnp:224c1bd0f89ae62188b47491fc48e2cf841f0112", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-224c1bd0f89ae62188b47491fc48e2cf841f0112/node_modules/@rollup/pluginutils/"),
      packageDependencies: new Map([
        ["rollup", "1.32.1"],
        ["@types/estree", "0.0.39"],
        ["estree-walker", "1.0.1"],
        ["micromatch", "4.0.2"],
        ["@rollup/pluginutils", "pnp:224c1bd0f89ae62188b47491fc48e2cf841f0112"],
      ]),
    }],
  ])],
  ["@types/estree", new Map([
    ["0.0.39", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@types-estree-0.0.39-e177e699ee1b8c22d23174caaa7422644389509f-integrity/node_modules/@types/estree/"),
      packageDependencies: new Map([
        ["@types/estree", "0.0.39"],
      ]),
    }],
    ["0.0.44", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@types-estree-0.0.44-980cc5a29a3ef3bea6ff1f7d021047d7ea575e21-integrity/node_modules/@types/estree/"),
      packageDependencies: new Map([
        ["@types/estree", "0.0.44"],
      ]),
    }],
  ])],
  ["estree-walker", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-estree-walker-1.0.1-31bc5d612c96b704106b477e6dd5d8aa138cb700-integrity/node_modules/estree-walker/"),
      packageDependencies: new Map([
        ["estree-walker", "1.0.1"],
      ]),
    }],
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-estree-walker-0.6.1-53049143f40c6eb918b23671d1fe3219f3a1b362-integrity/node_modules/estree-walker/"),
      packageDependencies: new Map([
        ["estree-walker", "0.6.1"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-micromatch-4.0.2-4fcb0999bf9fbc2fcbdd212f6d629b9a56c39259-integrity/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["braces", "3.0.2"],
        ["picomatch", "2.2.2"],
        ["micromatch", "4.0.2"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107-integrity/node_modules/braces/"),
      packageDependencies: new Map([
        ["fill-range", "7.0.1"],
        ["braces", "3.0.2"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40-integrity/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["to-regex-range", "5.0.1"],
        ["fill-range", "7.0.1"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4-integrity/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
        ["to-regex-range", "5.0.1"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b-integrity/node_modules/is-number/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
      ]),
    }],
  ])],
  ["picomatch", new Map([
    ["2.2.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-picomatch-2.2.2-21f333e9b6b8eaff02468f5146ea406d345f4dad-integrity/node_modules/picomatch/"),
      packageDependencies: new Map([
        ["picomatch", "2.2.2"],
      ]),
    }],
  ])],
  ["is-reference", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-is-reference-1.1.4-3f95849886ddb70256a3e6d062b1a68c13c51427-integrity/node_modules/is-reference/"),
      packageDependencies: new Map([
        ["@types/estree", "0.0.39"],
        ["is-reference", "1.1.4"],
      ]),
    }],
  ])],
  ["magic-string", new Map([
    ["0.25.7", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-magic-string-0.25.7-3f497d6fd34c669c6798dcb821f2ef31f5445051-integrity/node_modules/magic-string/"),
      packageDependencies: new Map([
        ["sourcemap-codec", "1.4.8"],
        ["magic-string", "0.25.7"],
      ]),
    }],
  ])],
  ["sourcemap-codec", new Map([
    ["1.4.8", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-sourcemap-codec-1.4.8-ea804bd94857402e6992d05a38ef1ae35a9ab4c4-integrity/node_modules/sourcemap-codec/"),
      packageDependencies: new Map([
        ["sourcemap-codec", "1.4.8"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.16.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-1.16.1-49fac5d8bacf1fd53f200fa51247ae736175832c-integrity/node_modules/resolve/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
        ["resolve", "1.16.1"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c-integrity/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.6"],
      ]),
    }],
  ])],
  ["@rollup/plugin-node-resolve", new Map([
    ["7.1.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@rollup-plugin-node-resolve-7.1.3-80de384edfbd7bfc9101164910f86078151a3eca-integrity/node_modules/@rollup/plugin-node-resolve/"),
      packageDependencies: new Map([
        ["rollup", "1.32.1"],
        ["@rollup/pluginutils", "pnp:224c1bd0f89ae62188b47491fc48e2cf841f0112"],
        ["@types/resolve", "0.0.8"],
        ["builtin-modules", "3.1.0"],
        ["is-module", "1.0.0"],
        ["resolve", "1.16.1"],
        ["@rollup/plugin-node-resolve", "7.1.3"],
      ]),
    }],
  ])],
  ["@types/resolve", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@types-resolve-0.0.8-f26074d238e02659e323ce1a13d041eee280e194-integrity/node_modules/@types/resolve/"),
      packageDependencies: new Map([
        ["@types/node", "13.13.0"],
        ["@types/resolve", "0.0.8"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["13.13.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@types-node-13.13.0-30d2d09f623fe32cde9cb582c7a6eda2788ce4a8-integrity/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["@types/node", "13.13.0"],
      ]),
    }],
  ])],
  ["builtin-modules", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-builtin-modules-3.1.0-aad97c15131eb76b65b50ef208e7584cd76a7484-integrity/node_modules/builtin-modules/"),
      packageDependencies: new Map([
        ["builtin-modules", "3.1.0"],
      ]),
    }],
  ])],
  ["is-module", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-is-module-1.0.0-3258fb69f78c14d5b815d664336b4cffb6441591-integrity/node_modules/is-module/"),
      packageDependencies: new Map([
        ["is-module", "1.0.0"],
      ]),
    }],
  ])],
  ["rollup", new Map([
    ["1.32.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-1.32.1-4480e52d9d9e2ae4b46ba0d9ddeaf3163940f9c4-integrity/node_modules/rollup/"),
      packageDependencies: new Map([
        ["@types/estree", "0.0.44"],
        ["@types/node", "13.13.0"],
        ["acorn", "7.1.1"],
        ["rollup", "1.32.1"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["7.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-acorn-7.1.1-e35668de0b402f359de515c5482a1ab9f89a69bf-integrity/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "7.1.1"],
      ]),
    }],
  ])],
  ["rollup-plugin-livereload", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-plugin-livereload-1.2.0-cda0d6435cf01cabfa01a92654d3c8eacee96fe0-integrity/node_modules/rollup-plugin-livereload/"),
      packageDependencies: new Map([
        ["livereload", "0.9.1"],
        ["rollup-plugin-livereload", "1.2.0"],
      ]),
    }],
  ])],
  ["livereload", new Map([
    ["0.9.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-livereload-0.9.1-65125dabdf2db4fd3f1169e953fe56e3bcc6f477-integrity/node_modules/livereload/"),
      packageDependencies: new Map([
        ["chokidar", "3.3.1"],
        ["livereload-js", "3.2.2"],
        ["opts", "1.2.7"],
        ["ws", "6.2.1"],
        ["livereload", "0.9.1"],
      ]),
    }],
  ])],
  ["chokidar", new Map([
    ["3.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-chokidar-3.3.1-c84e5b3d18d9a4d77558fef466b1bf16bbeb3450-integrity/node_modules/chokidar/"),
      packageDependencies: new Map([
        ["anymatch", "3.1.1"],
        ["braces", "3.0.2"],
        ["glob-parent", "5.1.1"],
        ["is-binary-path", "2.1.0"],
        ["is-glob", "4.0.1"],
        ["normalize-path", "3.0.0"],
        ["readdirp", "3.3.0"],
        ["chokidar", "3.3.1"],
      ]),
    }],
  ])],
  ["anymatch", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-anymatch-3.1.1-c55ecf02185e2469259399310c173ce31233b142-integrity/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
        ["picomatch", "2.2.2"],
        ["anymatch", "3.1.1"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65-integrity/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["5.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-glob-parent-5.1.1-b6c1ef417c4e5663ea498f1c45afac6916bbc229-integrity/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.1"],
        ["glob-parent", "5.1.1"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc-integrity/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.1"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
  ])],
  ["is-binary-path", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-is-binary-path-2.1.0-ea1f7f3b80f064236e83470f86c09c254fb45b09-integrity/node_modules/is-binary-path/"),
      packageDependencies: new Map([
        ["binary-extensions", "2.0.0"],
        ["is-binary-path", "2.1.0"],
      ]),
    }],
  ])],
  ["binary-extensions", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-binary-extensions-2.0.0-23c0df14f6a88077f5f986c0d167ec03c3d5537c-integrity/node_modules/binary-extensions/"),
      packageDependencies: new Map([
        ["binary-extensions", "2.0.0"],
      ]),
    }],
  ])],
  ["readdirp", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-readdirp-3.3.0-984458d13a1e42e2e9f5841b129e162f369aff17-integrity/node_modules/readdirp/"),
      packageDependencies: new Map([
        ["picomatch", "2.2.2"],
        ["readdirp", "3.3.0"],
      ]),
    }],
  ])],
  ["livereload-js", new Map([
    ["3.2.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-livereload-js-3.2.2-fffb018fb8a8b06d366ca1b03af6048b8732d20f-integrity/node_modules/livereload-js/"),
      packageDependencies: new Map([
        ["livereload-js", "3.2.2"],
      ]),
    }],
  ])],
  ["opts", new Map([
    ["1.2.7", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-opts-1.2.7-4de4721d592c96901dae623a438c988e9ea7779f-integrity/node_modules/opts/"),
      packageDependencies: new Map([
        ["opts", "1.2.7"],
      ]),
    }],
  ])],
  ["ws", new Map([
    ["6.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-ws-6.2.1-442fdf0a47ed64f59b6a5d8ff130f4748ed524fb-integrity/node_modules/ws/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.1"],
        ["ws", "6.2.1"],
      ]),
    }],
  ])],
  ["async-limiter", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-async-limiter-1.0.1-dd379e94f0db8310b08291f9d64c3209766617fd-integrity/node_modules/async-limiter/"),
      packageDependencies: new Map([
        ["async-limiter", "1.0.1"],
      ]),
    }],
  ])],
  ["rollup-plugin-svelte", new Map([
    ["5.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-plugin-svelte-5.2.1-f9d362d1b1d8cef0fa3782f2270f9261b715644c-integrity/node_modules/rollup-plugin-svelte/"),
      packageDependencies: new Map([
        ["svelte", "3.20.1"],
        ["rollup", "1.32.1"],
        ["require-relative", "0.8.7"],
        ["rollup-pluginutils", "2.8.2"],
        ["sourcemap-codec", "1.4.8"],
        ["rollup-plugin-svelte", "5.2.1"],
      ]),
    }],
  ])],
  ["require-relative", new Map([
    ["0.8.7", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-require-relative-0.8.7-7999539fc9e047a37928fa196f8e1563dabd36de-integrity/node_modules/require-relative/"),
      packageDependencies: new Map([
        ["require-relative", "0.8.7"],
      ]),
    }],
  ])],
  ["rollup-pluginutils", new Map([
    ["2.8.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-pluginutils-2.8.2-72f2af0748b592364dbd3389e600e5a9444a351e-integrity/node_modules/rollup-pluginutils/"),
      packageDependencies: new Map([
        ["estree-walker", "0.6.1"],
        ["rollup-pluginutils", "2.8.2"],
      ]),
    }],
  ])],
  ["rollup-plugin-terser", new Map([
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-plugin-terser-5.3.0-9c0dd33d5771df9630cd027d6a2559187f65885e-integrity/node_modules/rollup-plugin-terser/"),
      packageDependencies: new Map([
        ["rollup", "1.32.1"],
        ["@babel/code-frame", "7.8.3"],
        ["jest-worker", "24.9.0"],
        ["rollup-pluginutils", "2.8.2"],
        ["serialize-javascript", "2.1.2"],
        ["terser", "4.6.11"],
        ["rollup-plugin-terser", "5.3.0"],
      ]),
    }],
  ])],
  ["@babel/code-frame", new Map([
    ["7.8.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@babel-code-frame-7.8.3-33e25903d7481181534e12ec0a25f16b6fcf419e-integrity/node_modules/@babel/code-frame/"),
      packageDependencies: new Map([
        ["@babel/highlight", "7.9.0"],
        ["@babel/code-frame", "7.8.3"],
      ]),
    }],
  ])],
  ["@babel/highlight", new Map([
    ["7.9.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@babel-highlight-7.9.0-4e9b45ccb82b79607271b2979ad82c7b68163079-integrity/node_modules/@babel/highlight/"),
      packageDependencies: new Map([
        ["@babel/helper-validator-identifier", "7.9.5"],
        ["chalk", "2.4.2"],
        ["js-tokens", "4.0.0"],
        ["@babel/highlight", "7.9.0"],
      ]),
    }],
  ])],
  ["@babel/helper-validator-identifier", new Map([
    ["7.9.5", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-@babel-helper-validator-identifier-7.9.5-90977a8e6fbf6b431a7dc31752eee233bf052d80-integrity/node_modules/@babel/helper-validator-identifier/"),
      packageDependencies: new Map([
        ["@babel/helper-validator-identifier", "7.9.5"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["2.4.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424-integrity/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "3.2.1"],
        ["escape-string-regexp", "1.0.5"],
        ["supports-color", "5.5.0"],
        ["chalk", "2.4.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["3.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d-integrity/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "1.9.3"],
        ["ansi-styles", "3.2.1"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8-integrity/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
        ["color-convert", "1.9.3"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25-integrity/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.3"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4-integrity/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "1.0.5"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["5.5.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "5.5.0"],
      ]),
    }],
    ["6.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-supports-color-6.1.0-0764abc69c63d5ac842dd4867e8d025e880df8f3-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
        ["supports-color", "6.1.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd-integrity/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "3.0.0"],
      ]),
    }],
  ])],
  ["js-tokens", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499-integrity/node_modules/js-tokens/"),
      packageDependencies: new Map([
        ["js-tokens", "4.0.0"],
      ]),
    }],
  ])],
  ["jest-worker", new Map([
    ["24.9.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-jest-worker-24.9.0-5dbfdb5b2d322e98567898238a9697bcce67b3e5-integrity/node_modules/jest-worker/"),
      packageDependencies: new Map([
        ["merge-stream", "2.0.0"],
        ["supports-color", "6.1.0"],
        ["jest-worker", "24.9.0"],
      ]),
    }],
  ])],
  ["merge-stream", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60-integrity/node_modules/merge-stream/"),
      packageDependencies: new Map([
        ["merge-stream", "2.0.0"],
      ]),
    }],
  ])],
  ["serialize-javascript", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-2.1.2-ecec53b0e0317bdc95ef76ab7074b7384785fa61-integrity/node_modules/serialize-javascript/"),
      packageDependencies: new Map([
        ["serialize-javascript", "2.1.2"],
      ]),
    }],
  ])],
  ["terser", new Map([
    ["4.6.11", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-terser-4.6.11-12ff99fdd62a26de2a82f508515407eb6ccd8a9f-integrity/node_modules/terser/"),
      packageDependencies: new Map([
        ["commander", "2.20.3"],
        ["source-map", "0.6.1"],
        ["source-map-support", "0.5.16"],
        ["terser", "4.6.11"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.20.3", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-commander-2.20.3-fd485e84c03eb4881c20722ba48035e8531aeb33-integrity/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.20.3"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263-integrity/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.6.1"],
      ]),
    }],
  ])],
  ["source-map-support", new Map([
    ["0.5.16", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-support-0.5.16-0ae069e7fe3ba7538c64c98515e35339eac5a042-integrity/node_modules/source-map-support/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.1"],
        ["source-map", "0.6.1"],
        ["source-map-support", "0.5.16"],
      ]),
    }],
  ])],
  ["buffer-from", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-buffer-from-1.1.1-32713bc028f75c02fdb710d7c7bcec1f2c6070ef-integrity/node_modules/buffer-from/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.1"],
      ]),
    }],
  ])],
  ["svelte", new Map([
    ["3.20.1", {
      packageLocation: path.resolve(__dirname, "../../../../AppData/Local/Yarn/Cache/v6/npm-svelte-3.20.1-8417fcd883a2f534b642a0737368272e651cf3ac-integrity/node_modules/svelte/"),
      packageDependencies: new Map([
        ["svelte", "3.20.1"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["sirv-cli", "0.4.5"],
        ["@rollup/plugin-commonjs", "11.0.2"],
        ["@rollup/plugin-node-resolve", "7.1.3"],
        ["rollup", "1.32.1"],
        ["rollup-plugin-livereload", "1.2.0"],
        ["rollup-plugin-svelte", "5.2.1"],
        ["rollup-plugin-terser", "5.3.0"],
        ["svelte", "3.20.1"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["./.pnp/externals/pnp-fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086/node_modules/@rollup/pluginutils/", blacklistedLocator],
  ["./.pnp/externals/pnp-224c1bd0f89ae62188b47491fc48e2cf841f0112/node_modules/@rollup/pluginutils/", blacklistedLocator],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-sirv-cli-0.4.5-fecdfdd943000797f79c6652a1ce272cdb8df369-integrity/node_modules/sirv-cli/", {"name":"sirv-cli","reference":"0.4.5"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-console-clear-1.1.1-995e20cbfbf14dd792b672cde387bd128d674bf7-integrity/node_modules/console-clear/", {"name":"console-clear","reference":"1.1.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-get-port-3.2.0-dd7ce7de187c06c8bf353796ac71e099f0980ebc-integrity/node_modules/get-port/", {"name":"get-port","reference":"3.2.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-kleur-3.0.3-a79c9ecc86ee1ce3fa6206d1216c501f147fc07e-integrity/node_modules/kleur/", {"name":"kleur","reference":"3.0.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-local-access-1.0.1-5121258146d64e869046c642ea4f1dd39ff942bb-integrity/node_modules/local-access/", {"name":"local-access","reference":"1.0.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-sade-1.7.3-a217ccc4fb4abb2d271648bf48f6628b2636fa1b-integrity/node_modules/sade/", {"name":"sade","reference":"1.7.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-mri-1.1.5-ce21dba2c69f74a9b7cf8a1ec62307e089e223e0-integrity/node_modules/mri/", {"name":"mri","reference":"1.1.5"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-sirv-0.4.2-842ed22f3aab58faee84eea66cf66066e123d6db-integrity/node_modules/sirv/", {"name":"sirv","reference":"0.4.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@polka-url-0.5.0-b21510597fd601e5d7c95008b76bf0d254ebfd31-integrity/node_modules/@polka/url/", {"name":"@polka/url","reference":"0.5.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-mime-2.4.4-bd7b91135fc6b01cde3e9bae33d659b63d8857e5-integrity/node_modules/mime/", {"name":"mime","reference":"2.4.4"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-tinydate-1.2.0-36b4bb02715f89743f3ef9073d3573d005a28d0e-integrity/node_modules/tinydate/", {"name":"tinydate","reference":"1.2.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@rollup-plugin-commonjs-11.0.2-837cc6950752327cb90177b608f0928a4e60b582-integrity/node_modules/@rollup/plugin-commonjs/", {"name":"@rollup/plugin-commonjs","reference":"11.0.2"}],
  ["./.pnp/externals/pnp-fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086/node_modules/@rollup/pluginutils/", {"name":"@rollup/pluginutils","reference":"pnp:fd2ee90a5f7178cb05ff98ddcfff1be89dd5a086"}],
  ["./.pnp/externals/pnp-224c1bd0f89ae62188b47491fc48e2cf841f0112/node_modules/@rollup/pluginutils/", {"name":"@rollup/pluginutils","reference":"pnp:224c1bd0f89ae62188b47491fc48e2cf841f0112"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@types-estree-0.0.39-e177e699ee1b8c22d23174caaa7422644389509f-integrity/node_modules/@types/estree/", {"name":"@types/estree","reference":"0.0.39"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@types-estree-0.0.44-980cc5a29a3ef3bea6ff1f7d021047d7ea575e21-integrity/node_modules/@types/estree/", {"name":"@types/estree","reference":"0.0.44"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-estree-walker-1.0.1-31bc5d612c96b704106b477e6dd5d8aa138cb700-integrity/node_modules/estree-walker/", {"name":"estree-walker","reference":"1.0.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-estree-walker-0.6.1-53049143f40c6eb918b23671d1fe3219f3a1b362-integrity/node_modules/estree-walker/", {"name":"estree-walker","reference":"0.6.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-micromatch-4.0.2-4fcb0999bf9fbc2fcbdd212f6d629b9a56c39259-integrity/node_modules/micromatch/", {"name":"micromatch","reference":"4.0.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107-integrity/node_modules/braces/", {"name":"braces","reference":"3.0.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40-integrity/node_modules/fill-range/", {"name":"fill-range","reference":"7.0.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4-integrity/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"5.0.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b-integrity/node_modules/is-number/", {"name":"is-number","reference":"7.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-picomatch-2.2.2-21f333e9b6b8eaff02468f5146ea406d345f4dad-integrity/node_modules/picomatch/", {"name":"picomatch","reference":"2.2.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-is-reference-1.1.4-3f95849886ddb70256a3e6d062b1a68c13c51427-integrity/node_modules/is-reference/", {"name":"is-reference","reference":"1.1.4"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-magic-string-0.25.7-3f497d6fd34c669c6798dcb821f2ef31f5445051-integrity/node_modules/magic-string/", {"name":"magic-string","reference":"0.25.7"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-sourcemap-codec-1.4.8-ea804bd94857402e6992d05a38ef1ae35a9ab4c4-integrity/node_modules/sourcemap-codec/", {"name":"sourcemap-codec","reference":"1.4.8"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-1.16.1-49fac5d8bacf1fd53f200fa51247ae736175832c-integrity/node_modules/resolve/", {"name":"resolve","reference":"1.16.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-path-parse-1.0.6-d62dbb5679405d72c4737ec58600e9ddcf06d24c-integrity/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.6"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@rollup-plugin-node-resolve-7.1.3-80de384edfbd7bfc9101164910f86078151a3eca-integrity/node_modules/@rollup/plugin-node-resolve/", {"name":"@rollup/plugin-node-resolve","reference":"7.1.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@types-resolve-0.0.8-f26074d238e02659e323ce1a13d041eee280e194-integrity/node_modules/@types/resolve/", {"name":"@types/resolve","reference":"0.0.8"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@types-node-13.13.0-30d2d09f623fe32cde9cb582c7a6eda2788ce4a8-integrity/node_modules/@types/node/", {"name":"@types/node","reference":"13.13.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-builtin-modules-3.1.0-aad97c15131eb76b65b50ef208e7584cd76a7484-integrity/node_modules/builtin-modules/", {"name":"builtin-modules","reference":"3.1.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-is-module-1.0.0-3258fb69f78c14d5b815d664336b4cffb6441591-integrity/node_modules/is-module/", {"name":"is-module","reference":"1.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-1.32.1-4480e52d9d9e2ae4b46ba0d9ddeaf3163940f9c4-integrity/node_modules/rollup/", {"name":"rollup","reference":"1.32.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-acorn-7.1.1-e35668de0b402f359de515c5482a1ab9f89a69bf-integrity/node_modules/acorn/", {"name":"acorn","reference":"7.1.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-plugin-livereload-1.2.0-cda0d6435cf01cabfa01a92654d3c8eacee96fe0-integrity/node_modules/rollup-plugin-livereload/", {"name":"rollup-plugin-livereload","reference":"1.2.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-livereload-0.9.1-65125dabdf2db4fd3f1169e953fe56e3bcc6f477-integrity/node_modules/livereload/", {"name":"livereload","reference":"0.9.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-chokidar-3.3.1-c84e5b3d18d9a4d77558fef466b1bf16bbeb3450-integrity/node_modules/chokidar/", {"name":"chokidar","reference":"3.3.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-anymatch-3.1.1-c55ecf02185e2469259399310c173ce31233b142-integrity/node_modules/anymatch/", {"name":"anymatch","reference":"3.1.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65-integrity/node_modules/normalize-path/", {"name":"normalize-path","reference":"3.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-glob-parent-5.1.1-b6c1ef417c4e5663ea498f1c45afac6916bbc229-integrity/node_modules/glob-parent/", {"name":"glob-parent","reference":"5.1.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-is-glob-4.0.1-7567dbe9f2f5e2467bc77ab83c4a29482407a5dc-integrity/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-is-binary-path-2.1.0-ea1f7f3b80f064236e83470f86c09c254fb45b09-integrity/node_modules/is-binary-path/", {"name":"is-binary-path","reference":"2.1.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-binary-extensions-2.0.0-23c0df14f6a88077f5f986c0d167ec03c3d5537c-integrity/node_modules/binary-extensions/", {"name":"binary-extensions","reference":"2.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-readdirp-3.3.0-984458d13a1e42e2e9f5841b129e162f369aff17-integrity/node_modules/readdirp/", {"name":"readdirp","reference":"3.3.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-livereload-js-3.2.2-fffb018fb8a8b06d366ca1b03af6048b8732d20f-integrity/node_modules/livereload-js/", {"name":"livereload-js","reference":"3.2.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-opts-1.2.7-4de4721d592c96901dae623a438c988e9ea7779f-integrity/node_modules/opts/", {"name":"opts","reference":"1.2.7"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-ws-6.2.1-442fdf0a47ed64f59b6a5d8ff130f4748ed524fb-integrity/node_modules/ws/", {"name":"ws","reference":"6.2.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-async-limiter-1.0.1-dd379e94f0db8310b08291f9d64c3209766617fd-integrity/node_modules/async-limiter/", {"name":"async-limiter","reference":"1.0.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-plugin-svelte-5.2.1-f9d362d1b1d8cef0fa3782f2270f9261b715644c-integrity/node_modules/rollup-plugin-svelte/", {"name":"rollup-plugin-svelte","reference":"5.2.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-require-relative-0.8.7-7999539fc9e047a37928fa196f8e1563dabd36de-integrity/node_modules/require-relative/", {"name":"require-relative","reference":"0.8.7"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-pluginutils-2.8.2-72f2af0748b592364dbd3389e600e5a9444a351e-integrity/node_modules/rollup-pluginutils/", {"name":"rollup-pluginutils","reference":"2.8.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-rollup-plugin-terser-5.3.0-9c0dd33d5771df9630cd027d6a2559187f65885e-integrity/node_modules/rollup-plugin-terser/", {"name":"rollup-plugin-terser","reference":"5.3.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@babel-code-frame-7.8.3-33e25903d7481181534e12ec0a25f16b6fcf419e-integrity/node_modules/@babel/code-frame/", {"name":"@babel/code-frame","reference":"7.8.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@babel-highlight-7.9.0-4e9b45ccb82b79607271b2979ad82c7b68163079-integrity/node_modules/@babel/highlight/", {"name":"@babel/highlight","reference":"7.9.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-@babel-helper-validator-identifier-7.9.5-90977a8e6fbf6b431a7dc31752eee233bf052d80-integrity/node_modules/@babel/helper-validator-identifier/", {"name":"@babel/helper-validator-identifier","reference":"7.9.5"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-chalk-2.4.2-cd42541677a54333cf541a49108c1432b44c9424-integrity/node_modules/chalk/", {"name":"chalk","reference":"2.4.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-ansi-styles-3.2.1-41fbb20243e50b12be0f04b8dedbf07520ce841d-integrity/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"3.2.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-color-convert-1.9.3-bb71850690e1f136567de629d2d5471deda4c1e8-integrity/node_modules/color-convert/", {"name":"color-convert","reference":"1.9.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-color-name-1.1.3-a7d0558bd89c42f795dd42328f740831ca53bc25-integrity/node_modules/color-name/", {"name":"color-name","reference":"1.1.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-escape-string-regexp-1.0.5-1b61c0562190a8dff6ae3bb2cf0200ca130b86d4-integrity/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"1.0.5"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-supports-color-5.5.0-e2e69a44ac8772f78a1ec0b35b689df6530efc8f-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"5.5.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-supports-color-6.1.0-0764abc69c63d5ac842dd4867e8d025e880df8f3-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"6.1.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-has-flag-3.0.0-b5d454dc2199ae225699f3467e5a07f3b955bafd-integrity/node_modules/has-flag/", {"name":"has-flag","reference":"3.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-js-tokens-4.0.0-19203fb59991df98e3a287050d4647cdeaf32499-integrity/node_modules/js-tokens/", {"name":"js-tokens","reference":"4.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-jest-worker-24.9.0-5dbfdb5b2d322e98567898238a9697bcce67b3e5-integrity/node_modules/jest-worker/", {"name":"jest-worker","reference":"24.9.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60-integrity/node_modules/merge-stream/", {"name":"merge-stream","reference":"2.0.0"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-2.1.2-ecec53b0e0317bdc95ef76ab7074b7384785fa61-integrity/node_modules/serialize-javascript/", {"name":"serialize-javascript","reference":"2.1.2"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-terser-4.6.11-12ff99fdd62a26de2a82f508515407eb6ccd8a9f-integrity/node_modules/terser/", {"name":"terser","reference":"4.6.11"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-commander-2.20.3-fd485e84c03eb4881c20722ba48035e8531aeb33-integrity/node_modules/commander/", {"name":"commander","reference":"2.20.3"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263-integrity/node_modules/source-map/", {"name":"source-map","reference":"0.6.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-support-0.5.16-0ae069e7fe3ba7538c64c98515e35339eac5a042-integrity/node_modules/source-map-support/", {"name":"source-map-support","reference":"0.5.16"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-buffer-from-1.1.1-32713bc028f75c02fdb710d7c7bcec1f2c6070ef-integrity/node_modules/buffer-from/", {"name":"buffer-from","reference":"1.1.1"}],
  ["../../../../AppData/Local/Yarn/Cache/v6/npm-svelte-3.20.1-8417fcd883a2f534b642a0737368272e651cf3ac-integrity/node_modules/svelte/", {"name":"svelte","reference":"3.20.1"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 184 && relativeLocation[183] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 184)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 170 && relativeLocation[169] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 170)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 164 && relativeLocation[163] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 164)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 163 && relativeLocation[162] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 163)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 156 && relativeLocation[155] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 156)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 153 && relativeLocation[152] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 153)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 152 && relativeLocation[151] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 152)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 150 && relativeLocation[149] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 150)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 148 && relativeLocation[147] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 148)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 146 && relativeLocation[145] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 146)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 144 && relativeLocation[143] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 144)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 142 && relativeLocation[141] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 142)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 140 && relativeLocation[139] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 140)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 136 && relativeLocation[135] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 136)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 130 && relativeLocation[129] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 130)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 122 && relativeLocation[121] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 122)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 120 && relativeLocation[119] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 120)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 95 && relativeLocation[94] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 95)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
