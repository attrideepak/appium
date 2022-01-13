// @ts-check

// transpile:mocha
import _ from 'lodash';
import path from 'path';
import B from 'bluebird';
import { remote as wdio } from 'webdriverio';
import axios from 'axios';
import { main as appiumServer } from '../lib/main';
import { INSTALL_TYPE_LOCAL } from '../lib/extension-config';
import { W3C_PREFIXED_CAPS, TEST_HOST, getTestPort, PROJECT_ROOT } from './helpers';
import { runExtensionCommand } from '../lib/cli/extension';
import { env } from '@appium/support';
import { loadExtensions } from '../lib/manifest-io';

const {DEFAULT_APPIUM_HOME} = env;
const FAKE_ARGS = {sillyWebServerPort: 1234, host: 'hey'};
const FAKE_PLUGIN_ARGS = {fake: FAKE_ARGS};

const should = chai.should();

/** @type {WebdriverIO.RemoteOptions} */
const wdOpts = {
  hostname: TEST_HOST,
  connectionRetryCount: 0,
  capabilities: W3C_PREFIXED_CAPS,
};

describe('FakePlugin', function () {
  const fakePluginDir = path.join(PROJECT_ROOT, 'node_modules', '@appium', 'fake-plugin');
  const fakeDriverDir = path.join(PROJECT_ROOT, 'packages', 'fake-driver');
  const appiumHome = DEFAULT_APPIUM_HOME;
  let baseArgs;
  let testServer;
  let testPort;
  let baseUrl;

  before(async function () {
    wdOpts.port = testPort = await getTestPort();
    testServer = `http://${TEST_HOST}:${testPort}`;
    baseUrl = `${testServer}/session`;
    const {driverConfig, pluginConfig} = await loadExtensions(appiumHome);
    // first ensure we have fakedriver installed
    const driverList = await runExtensionCommand({
      driverCommand: 'list',
      showInstalled: true,
    }, driverConfig
    );
    if (!_.has(driverList, 'fake')) {
      await runExtensionCommand({
        driverCommand: 'install',
        driver: fakeDriverDir,
        installType: INSTALL_TYPE_LOCAL,
      }, driverConfig
      );
    }

    const pluginList = await runExtensionCommand({
      pluginCommand: 'list',
      showInstalled: true,
    }, pluginConfig);
    if (!_.has(pluginList, 'fake')) {
      await runExtensionCommand({
        pluginCommand: 'install',
        plugin: fakePluginDir,
        installType: INSTALL_TYPE_LOCAL,
      }, pluginConfig);
    }
    baseArgs = {port: testPort, host: TEST_HOST, usePlugins: ['fake'], useDrivers: ['fake']};
  });

  describe('without plugin registered', function () {
    let server = null;
    before(async function () {
      // then start server if we need to

      const args = {port: testPort, address: TEST_HOST, usePlugins: ['other1', 'other2']};
      server = await appiumServer(/** @type {import('../types/types').ParsedArgs} */(args));
    });
    after(async function () {
      if (server) {
        await server.close();
      }
    });
    it('should not update the server if plugin is not activated', async function () {
      await axios.post(`http://${TEST_HOST}:${testPort}/fake`).should.eventually.be.rejectedWith(/404/);
    });
    it('should not update method map if plugin is not activated', async function () {
      const driver = await wdio(wdOpts);
      const {sessionId} = driver;
      try {
        await axios.post(`${baseUrl}/${sessionId}/fake_data`, {data: {fake: 'data'}}).should.eventually.be.rejectedWith(/404/);
      } finally {
        await driver.deleteSession();
      }
    });
    it('should not handle commands if plugin is not activated', async function () {
      const driver = await wdio(wdOpts);
      const {sessionId} = driver;
      try {
        const el = (await axios.post(`${baseUrl}/${sessionId}/element`, {using: 'xpath', value: '//MockWebView'})).data.value;
        el.should.not.have.property('fake');
      } finally {
        await driver.deleteSession();
      }
    });
  });

  for (const registrationType of ['explicit', 'all']) {
    describe(`with plugin registered via type ${registrationType}`, function () {
      let server = null;
      before(async function () {
        // then start server if we need to
        const usePlugins = registrationType === 'explicit' ? ['fake', 'p2', 'p3'] : ['all'];
        const args = {port: testPort, address: TEST_HOST, usePlugins, useDrivers: ['fake']};
        server = await appiumServer(/** @type {import('../types/types').ParsedArgs} */(args));
      });
      after(async function () {
        if (server) {
          await server.close();
        }
      });
      it('should update the server', async function () {
        const res = {fake: 'fakeResponse'};
        (await axios.post(`http://${TEST_HOST}:${testPort}/fake`)).data.should.eql(res);
      });

      it('should modify the method map with new commands', async function () {
        const driver = await wdio(wdOpts);
        const {sessionId} = driver;
        try {
          await axios.post(`${baseUrl}/${sessionId}/fake_data`, {data: {fake: 'data'}});
          (await axios.get(`${baseUrl}/${sessionId}/fake_data`)).data.value.should.eql({fake: 'data'});
        } finally {
          await driver.deleteSession();
        }
      });

      it('should handle commands and not call the original', async function () {
        const driver = await wdio(wdOpts);
        const {sessionId} = driver;
        try {
          await driver.getPageSource().should.eventually.eql(`<Fake>${JSON.stringify([sessionId])}</Fake>`);
        } finally {
          await driver.deleteSession();
        }
      });

      it('should handle commands and call the original if designed', async function () {
        const driver = await wdio(wdOpts);
        const {sessionId} = driver;
        try {
          const el = (await axios.post(`${baseUrl}/${sessionId}/element`, {using: 'xpath', value: '//MockWebView'})).data.value;
          el.should.have.property('fake');
        } finally {
          await driver.deleteSession();
        }
      });

      it('should allow original command to be proxied if supported', async function () {
        const driver = await wdio(wdOpts);
        const {sessionId} = driver;
        try {
          await axios.post(`${baseUrl}/${sessionId}/context`, {name: 'PROXY'});
          const handle = (await axios.get(`${baseUrl}/${sessionId}/window/handle`)).data.value;
          handle.should.eql('<<proxied via proxyCommand>>');
        } finally {
          await axios.post(`${baseUrl}/${sessionId}/context`, {name: 'NATIVE_APP'});
          await driver.deleteSession();
        }
      });

      it('should handle unexpected driver shutdown', async function () {
        /** @type {WebdriverIO.RemoteOptions} */
        const newOpts = {...wdOpts};
        newOpts.capabilities = {...newOpts.capabilities ?? {}, 'appium:newCommandTimeout': 1};
        const driver = await wdio(wdOpts);
        let shutdownErr;
        try {
          let res = await axios.get(`http://${TEST_HOST}:${testPort}/unexpected`);
          should.not.exist(res.data);
          await B.delay(1500);
          res = await axios.get(`http://${TEST_HOST}:${testPort}/unexpected`);
          res.data.should.match(/Session ended/);
          res.data.should.match(/timeout/);
          await driver.deleteSession();
        } catch (e) {
          shutdownErr = e;
        }
        shutdownErr.message.should.match(/either terminated or not started/);
      });
    });
  }
  describe('cli args handling for plugin args', function () {
    let server = null;
    before(async function () {
      // then start server if we need to
      const args = {...baseArgs, plugin: FAKE_PLUGIN_ARGS};
      server = await appiumServer(args);
    });
    after(async function () {
      if (server) {
        await server.close();
      }
    });

    it('should receive user cli args for plugin if passed in', async function () {
      const driver = await wdio(wdOpts);
      const {sessionId} = driver;
      try {
        const {data} = await axios.get(`${baseUrl}/${sessionId}/fakepluginargs`);
        data.value.should.eql(FAKE_ARGS);
      } finally {
        await driver.deleteSession();
      }
    });
  });
  describe('cli args handling for empty plugin args', function () {
    let server = null;
    before(async function () {
      // then start server if we need to
      server = await appiumServer(baseArgs);
    });
    after(async function () {
      if (server) {
        await server.close();
      }
    });

    it('should not receive user cli args for plugin if none were passed in', async function () {
      const driver = await wdio(wdOpts);
      const {sessionId} = driver;
      try {
        const {data} = await axios.get(`${baseUrl}/${sessionId}/fakepluginargs`);
        should.not.exist(data.value);
      } finally {
        await driver.deleteSession();
      }
    });
  });
});
