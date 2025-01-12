const axios = require('axios');
const fs = require('fs');
const { join } = require('path');

const { PostsQuery, PostQuery } = require('./query');

class Crawler {
  constructor(username, { delay, cert }) {
    this.username = username; 

    if (!username) {
      console.error('❌ 유저이름을 입력해주세요')
      process.exit(1);
    }

    // options
    this.delay = delay;
    this.cert = cert;

    this.__grahpqlURL = 'https://v2.velog.io/graphql';
    this.__api = axios.create({
      headers:{
        Cookie: cert ? `access_token=${cert};` : null,
      }, 
    });
  }

  async parse() {
    const posts = await this.getPosts();
    
    posts.map(async(postInfo, i) => { 
      if (this.delay > 0) await new Promise(r => setTimeout(r, this.delay * i));

      let post = await this.getPost(postInfo.url_slug);
      const save_title = post.title.replace(/[\\~#%&*{}/:<>?| \"-]/g, "_");
      if (!post) {
        console.log(`⚠️  " ${postInfo.url_slug} " 가져올 수 없는 글을 건너뛰었습니다.`);
        return;
      }
      post.body = await this.getImage(post.body, save_title);

      await this.writePost(post, save_title);
      console.log(`✅ " ${save_title} " 백업 완료`);
    });
  }

  async getPosts() {
    const url = `https://velog.io/@${this.username}`;
    let response;
    let posts = [];

    try {
      await this.__api.get(url);
    } catch (e) {
      if (e.response.status === 404) {
        console.error(`⚠️  해당 유저를 찾을 수 없어요 \n username = ${this.username}`);
        process.exit(1);
      }

      console.error(e);
    }

    while (true) {
      try {
        if (response && response.data.data.posts.length >= 20) {
          response = await this.__api.post(this.__grahpqlURL, PostsQuery(this.username, posts[posts.length - 1].id));
        } else {
          response = await this.__api.post(this.__grahpqlURL, PostsQuery(this.username));
        }
      } catch(e) {
        console.error(`⚠️  벨로그에서 글 목록을 가져오는데 실패했습니다. \n error = ${e}`);
        process.exit(1);
      }
      
      posts = [...posts, ...response.data.data.posts];
      if (response.data.data.posts.length < 20) break;
    }

    console.log(`✅ ${this.username}님의 모든 글(${posts.length} 개) 을 가져옴`);

    return posts;
  }

  async getPost(url_slug) {
    let response;

    try {
      response = await this.__api.post(this.__grahpqlURL, PostQuery(this.username, url_slug));
    } catch (e) {
      console.error(`⚠️  벨로그에서 글을 가져오는데 실패했습니다. \n error = ${e} url = ${url_slug}`);
      process.exit(1);
    }
    
    return response.data.data.post;
  }

  async writePost(post, title) {
    const excludedChar = ['\\\\', '/', ':' ,'\\*' ,'\\?' ,'"' ,'<' ,'>' ,'\\|'];

    const path = join('backup', 'content', title, `${title}.md`);

    post.body = '---\n'
                + `title: "${post.title}"\n`
                + `description: "${post.short_description.replace(/\n/g, ' ')}"\n`
                + `date: ${post.released_at}\n`
                + `tags: ${JSON.stringify(post.tags)}\n`
                + '---\n' + post.body;
    
    try {
      await fs.promises.writeFile(path, post.body, 'utf8');
    } catch (e) {
      console.error(`⚠️ 파일을 쓰는데 문제가 발생했습니다. / error = ${e}  title = ${post.title}`);
    }
  }

  async getImage(body, title) {
    const regex = /!\[[^\]]*\]\((.*?.png|.jpeg|.jpg|.webp|.svg|.gif|.tiff)\s*("(?:.*[^"])")?\s*\)|!\[[^\]]*\]\((.*?)\s*("(?:.*[^"])")?\s*\)/g;
    const global_path = join('backup', 'content', title);
    !fs.existsSync(global_path) && fs.mkdirSync(global_path);
    var idx = 0;
    
    body = body.replace(regex, (url) => {
      if (!url) return;
      const find_url_result = url.match(/\((.*?)\)/)[0].replace("(", "").replace(")", "");
      const ext = find_url_result.split('.').slice(-1)[0].replace(")", "");
      const path = join(global_path, decodeURI(`${String(idx)}.${ext}`));

      this.__api({
        method: 'get',
        url: encodeURI(decodeURI(find_url_result)),
        responseType: 'stream',
      })
      .then(resp => resp.data.pipe(fs.createWriteStream(path)))
      .catch(e => console.error(`⚠️ 이미지를 다운 받는데 오류가 발생했습니다 / url = ${url} , e = ${e}`));
      idx += 1;
      return `![](./${String(idx-1)}.${ext})`;

    });

    return body;
  }

};

module.exports = Crawler;
