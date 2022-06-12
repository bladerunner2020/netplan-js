Netplan-JS - read and update netplan configurations
=================================================

This is Node JS library for reading Netplan configurations and updating config files from NodeJS applications.

## Installation

```
npm install netplan-js
```

## Usage

Reading Netplan configurations:

```js
const Netplan = require('netplan-js');

const netplan = new Netplan();
netplan.loadConfigs().then(() => {
  const config = netplan.getInterface('ethernets', 'ens33');
  console.log('Current config:', JSON.stringify(config));
});
```

Updating Netplan configurations:

```js
const Netplan = require('netplan-js');

const netplan = new Netplan();
netplan.loadConfigs().then(() => {
  netplan.setInterface('ethernets', 'ens33', {
    dhcp4: false,
    addresses: ['192.168.1.105/24'],
    nameservers: { addresses: ['192.168.1.1'] },
    gateway4: '192.168.1.1',
  });
  netplan.writeConfigs().then(() => {
    netplan.apply()
      .then(() => console.log('Success'))
      .catch((err) => console.error(err.message));
  });
});
```
