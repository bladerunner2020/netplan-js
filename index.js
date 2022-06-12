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
      const arr = [...prev[key]];
      oVal.forEach((val) => {
        if (typeof val !== 'object' && !pVal.includes(val)) {
          arr.push(val);
        } else {
          const vv = JSON.stringify(val);
          if (oVal.map((v) => JSON.stringify(v)).filter((v) => v === vv).length === 0) {
            arr.push(val);
          }
        }
      });
      // prev[key] = pVal.concat(...oVal);
      prev[key] = arr; // eslint-disable-line no-param-reassign
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

  /**
   * load all configuration files
   */
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

  /**
   * write changed configuration files
   *
   * @returns {Promise<number>} - number of files written
   */
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
   * returns interfaces of specified type
   *
   * @param {string} [type='ethernets'] - ethernets, wifis, bridges
   * @returns {object} - description of interfaces
   */
  getInterfaces(type = 'ethernets') {
    const { network = {} } = this.plan;
    return network[type];
  }

  /**
   * get names of interfaces of specified type
   *
   * @param {string} type - ethernets, wifis, bridges
   * @returns {Array.string} - names of interfaces
   */
  getInterfaceNames(type) {
    const ifaces = this.getInterfaces(type);
    if (typeof ifaces !== 'object') return null;
    return Object.keys(ifaces);
  }

  /**
   * get description of interface with specified type and name
   *
   * @param {string} type - ethernets, wifis, bridges
   * @param {string} name - name of the interface
   * @returns {object}
   */
  getInterface(type, name) {
    const ifaces = this.getInterfaces(type);
    return typeof ifaces === 'object' ? ifaces[name] : null;
  }

  /**
   * find a configuration file that has description of interface and merge data to it
   * if specified interface not found then it searches for file containing interfaces of specified type
   * if not found uses the first configuration files
   * NOTE: this method doesn't write to file - use writeConfigs
   *
   * @param {string} type - ethernets, wifis, bridges
   * @param {string} name - name of the interface
   * @param {object} data - descritpion of the interface to set
   */
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

  /**
   * Execute netplan apply
   * @param {boolean} test - run netplan try
   * @returns {Promise<object>} - promise that contains result stdin and stdout
   */
  apply(test = false) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      const result = {};
      const child = spawn('netplan', [test ? 'try' : 'apply']);
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

  /**
   * Update plan after config files changed (called automatically)
   */
  updatePlan() {
    this.plan = { network: {} };
    this.configFiles.forEach((name) => {
      const res = this.configs[name];
      this.plan = mergeDeep(this.plan, res);
    });
  }

  /**
   * searches for config file name that has interface with type and name
   * starts from the end returns first matching filename
   * @param {string} type - ethernets, wifis, bridges
   * @param {name} name - name of the interface
   * @returns {string} - filename or null if not found
   */
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
