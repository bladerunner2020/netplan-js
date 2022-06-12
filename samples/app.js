/* eslint-disable no-console */
const Netplan = require('..');

const netplan = new Netplan({
  netplanPath: './yaml'
});

netplan.loadConfigs().then(() => {
  const config = netplan.getInterface('ethernets', 'ens33');
  console.log('Current config:', JSON.stringify(config));
  if (config.dhcp4 || config.dhcp) {
    netplan.setInterface('ethernets', 'ens33', {
      dhcp: undefined,
      dhcp4: false,
      addresses: ['192.168.1.105/24'],
      nameservers: ['192.168.1.1'],
      gateway4: '192.168.1.1',
    });
  } else {
    netplan.setInterface('ethernets', 'ens33', {
      dhcp4: true,
      addresses: undefined,
      nameservers: undefined,
      gateway4: undefined
    });
  }

  console.log('new config:', JSON.stringify(netplan.getInterface('ethernets', 'ens33')));

  netplan.writeConfigs();
});
