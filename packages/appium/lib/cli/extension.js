/* eslint-disable no-console */

import DriverCommand from './driver-command';
import PluginCommand from './plugin-command';
import { DRIVER_TYPE } from '../constants';
import { errAndQuit, log, JSON_SPACES } from './utils';

/**
 * Run a subcommand of the 'appium driver' type. Each subcommand has its own set of arguments which
 * can be represented as a JS object.
 *
 * @param {Object} args - JS object where the key is the parameter name (as defined in
 * driver-parser.js)
 * @template {ExtensionType} ExtType
 * @param {import('../extension-config').ExtensionConfig<ExtType>} configObject - Extension config object
 */
async function runExtensionCommand (args, configObject) {
  // TODO driver config file should be locked while any of these commands are
  // running to prevent weird situations
  let jsonResult = null;
  const {extensionType: type} = configObject;
  const extCmd = args[`${type}Command`];
  if (!extCmd) {
    throw new TypeError(`Cannot call ${type} command without a subcommand like 'install'`);
  }
  let {json, suppressOutput} = args;
  if (suppressOutput) {
    json = true;
  }
  const logFn = (msg) => log(json, msg);
  let config = configObject;
  config.log = logFn;
  const CommandClass = type === DRIVER_TYPE ? DriverCommand : PluginCommand;
  const cmd = new CommandClass({config, json});
  try {
    // await config.read();
    console.dir(args);
    jsonResult = await cmd.execute(args);
  } catch (err) {
    // in the suppress output case, we are calling this function internally and should
    // just throw instead of printing an error and ending the process
    if (suppressOutput) {
      throw err;
    }
    errAndQuit(json, err);
  }

  if (json && !suppressOutput) {
    console.log(JSON.stringify(jsonResult, null, JSON_SPACES));
  }

  return jsonResult;
}

export {
  runExtensionCommand,
};
