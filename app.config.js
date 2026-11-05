const baseConfig = require('./app.json');
const repository = process.env.GITHUB_REPOSITORY?.split('/').pop();
const baseUrl = process.env.GITHUB_PAGES === 'true' && repository ? `/${repository}` : '';

module.exports = {
  ...baseConfig,
  expo: {
    ...baseConfig.expo,
    web: { ...baseConfig.expo.web, output: 'single' },
    experiments: { ...baseConfig.expo.experiments, baseUrl },
  },
};

