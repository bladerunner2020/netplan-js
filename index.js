const debug = require('debug')('Netplan');
const { load: loadYaml, dump: dumpYaml } = require('js-yaml');
const { join: pathJoin } = require('path');
const {
  readdir, existsSync, readFileSync, writeFileSync
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

    // Accommodate /sbin and /usr/sbin in path
    const paths = new Set(process.env.PATH.split(':'));
    paths.add('/sbin');
    paths.add('/usr/sbin');

    this.binary = null;
    this.ipBinary = null;
    this.routeBinary = null;

    paths.forEach((item) => {
      const binary = pathJoin(item, 'netplan');
      const ipBinary = pathJoin(item, 'ip');
      const routeBinary = pathJoin(item, 'route');
      if (existsSync(binary)) this.binary = binary;
      if (existsSync(ipBinary)) this.ipBinary = ipBinary;
      if (existsSync(routeBinary)) this.routeBinary = routeBinary;
    });
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

  updatePlan() {
    this.plan = { network: {} };
    this.configFiles.forEach((name) => {
      const res = this.configs[name];
      this.plan = mergeDeep(this.plan, res);
    });
  }

  getEthernets() {
    const { ethernets = {} } = this.plan.network || {};
    return ethernets;
  }

  getEthernetInterfaces() {
    const { ethernets = {} } = this.plan.network || {};
    return Object.keys(ethernets);
  }

  getEthernetCount() {
    const { ethernets = {} } = this.plan.network || {};
    return Object.keys(ethernets).length;
  }

  getEthernetConfig(iface) {
    const { ethernets = {} } = this.plan.network || {};
    return ethernets[iface] || null;
  }

  findEthernetInterface(iface) {
    const { configFiles, configs } = this;
    for (let i = configFiles.length - 1; i >= 0; i--) {
      const name = configFiles[i];
      const { network = {} } = configs[name] || {};
      const { ethernets = {} } = network;
      if (typeof ethernets[iface] === 'object') return name;
    }

    return null;
  }

  setEthernet(iface, data) {
    const name = this.findEthernetInterface(iface);
    if (name) {
      this.changed.add(name);
      this.configs[name] = mergeDeep(this.configs[name], {
        network: {
          ethernets: {
            [iface]: data
          }
        }
      });
      this.updatePlan();
    }
  }
}

module.exports = Netplan;
