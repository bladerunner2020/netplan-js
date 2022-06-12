const debug = require('debug')('Netplan');
const { spawn } = require('child_process');
const { load: loadYaml, dump: dumpYaml } = require('js-yaml');
const {
  readdir, readFileSync, writeFileSync
} = require('fs');

const NETPLAN_PATH = '/etc/netplan';

const isObject = (obj) => obj && typeof obj === 'object';

const mergeDeep = (...objects) => objects.reduce((prev, obj) => {
  Object.keys(obj).forEach((key) => {
    const pVal = prev[key];
    const oVal = obj[key];

    if (Array.isArray(pVal) && Array.isArray(oVal)) {
      prev[key] = pVal.concat(...oVal); // eslint-disable-line no-param-reassign
    } else if (isObject(pVal) && isObject(oVal)) {
      prev[key] = mergeDeep(pVal, oVal); // eslint-disable-line no-param-reassign
    } else {
      prev[key] = oVal; // eslint-disable-line no-param-reassign
    }
  });

  return prev;
}, {});

const getConfigFilenames = (path) => new Promise((resolve, reject) => {
  readdir(path, (err, files) => {
    if (err) {
      reject(err);
      return;
    }
    const result = files
      .filter((file) => /\.yaml$/.test(file))
      .map((file) => `${path}/${file}`);

    resolve(result);
  });
});

class Netplan {
  constructor({
    netplanPath = NETPLAN_PATH
  } = {}) {
    this.netplanPath = netplanPath;
    this.plan = {};
    this.configs = {};
    this.configFiles = [];
    this.changed = new Set();
  }

  async loadConfigs() {
    const filenames = await getConfigFilenames(this.netplanPath);
    this.configFiles = filenames.sort();
    this.configs = {};
    this.plan = { network: {} };

    filenames.forEach((name) => {
      const data = readFileSync(name);
      const res = loadYaml(data) || {};
      this.configs[name] = res;
      this.plan = mergeDeep(this.plan, res);
    });
  }

  writeConfigs() {
    return new Promise((resolve, reject) => {
      debug(`writeConfigs: writing ${this.changed.size} file(s).`);
      try {
        this.changed.forEach((name) => {
          debug(`Writing: ${name}`);
          const data = dumpYaml(this.configs[name]);
          writeFileSync(name, data);
        });
        resolve(this.changed.size);
        this.changed = new Set();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   *
   * @param {string} type - ethernets, wifis, bridges
   * @returns {object}
   */
  getInterfaces(type = 'ethernets') {
    const { network = {} } = this.plan;
    return network[type];
  }

  getInterfaceNames(type) {
    const ifaces = this.getInterfaces(type);
    if (typeof ifaces !== 'object') return null;
    return Object.keys(ifaces);
  }

  getInterface(type, name) {
    const ifaces = this.getInterfaces(type);
    return typeof ifaces === 'object' ? ifaces[name] : null;
  }

  setInterface(type, name, data) {
    const filename = this.getFilenameByInterface(type, name) || this.getFilenameByInterface(type) || this.filenames[0];
    if (!filename) throw new Error('No configuration files');

    this.changed.add(filename);
    this.configs[filename] = mergeDeep(this.configs[filename], {
      network: {
        [type]: {
          [name]: data
        }
      }
    });
    this.updatePlan();
  }

  // eslint-disable-next-line class-methods-use-this
  apply() {
    return new Promise((resolve, reject) => {
      const result = {};
      const child = spawn('netplan', ['apply']);
      child.on('error', reject);

      child.stdout.on('data', (data) => {
        result.stdout = data.toString('utf8').trim();
      });

      child.stderr.on('data', (data) => {
        result.stderr = data.toString('utf8').trim();
      });

      child.on('close', (code) => {
        result.code = code;
        if (code !== 0) {
          const error = new Error(`netplan failed with code ${code}.`);
          error.stdout = result.stdout;
          error.stderr = result.stderr;
          error.code = code;
          return reject(error);
        }
        return resolve(result);
      });
    });
  }

  // Internal methods
  updatePlan() {
    this.plan = { network: {} };
    this.configFiles.forEach((name) => {
      const res = this.configs[name];
      this.plan = mergeDeep(this.plan, res);
    });
  }

  getFilenameByInterface(type, name) {
    const { configFiles, configs } = this;
    for (let i = configFiles.length - 1; i >= 0; i--) {
      const filename = configFiles[i];
      const { network = {} } = configs[filename] || {};
      const ifaces = network[type];
      if (typeof ifaces === 'object') {
        if (typeof name === 'undefined') return filename;
        if (typeof ifaces[name] === 'object') return filename;
      }
    }

    return null;
  }
}

module.exports = Netplan;
