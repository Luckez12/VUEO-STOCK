const provider = {
  id: "example",
  name: "Example Provider",
  version: "0.1.0",

  async search(query) {
    return [];
  },

  async getDetails(url) {
    return null;
  },

  async getEpisodes(url) {
    return [];
  },

  async getSources(episodeUrl) {
    return [];
  }
};

export default provider;
