/**
 * Created by gokuai on 17/6/7.
 */

const state = {
  filelist: null,
  fileloading: true,
  selectFile: {
    select: false
  },

  fileRightList: [
    {
      key: 'upload_file',
      name: '点击上传',
      index: 1,
      isActive: false
    },
    {
      key: 'new_folder',
      name: '新建文件夹',
      index: 2,
      isActive: false
    },
    {
      key: 'download_file',
      name: '下载',
      index: 3,
      isActive: false
    },
    {
      key: 'copy_file',
      name: '复制',
      index: 4,
      isActive: false
    },
    {
      key: 'delete_file',
      name: '删除',
      index: 5,
      isActive: false
    },
    {
      key: 'get_address',
      name: '获取地址',
      index: 6,
      isActive: false
    },
    {
      key: 'set_http',
      name: '设置HTTP头',
      index: 7,
      isActive: false
    },
    {
      key: 'paste_file',
      name: '粘贴',
      index: 8,
      isActive: false
    },
    {
      key: 'download_list',
      name: '下载当前目录',
      index: 9,
      isActive: false
    },
  ],
}

const mutations = {
  fileloading(state, val){
    state.fileloading = val.loading;
  },
  selectFile(state, val){
    state.filelist.forEach(function (file) {
      file.active = false;
      if (file.Name === val.fileName) {
        file.active = true;
        state.selectFile = file;
        if (file.dir) {
          state.selectFile.select = false;
        } else {
          state.selectFile.select = true;
        }
      }
    })
  },
  unSelectFile(state){
    state.filelist.forEach(function (file) {
      file.active = false;
    })
    state.selectFile = {
      select: false
    };
  },
  getFileList(state, data){
    // console.log('当前文件列表', data)
    let index = null;
    if (data.objects.length) {
      data.objects.forEach(function (item, idx) {
        if (item.Name == "") index = idx;
        item.active = false;
      })
    }
    if (data.dirs.length) {
      data.dirs.forEach(function (d) {
        d.active = false;
        d.dir = true;
      })
    }
    if (index != null) data.objects.splice(index, 1)
    state.filelist = data.objects.concat(data.dirs);
  },
  searchFileList(state, data){
    let index = null;
    if (data.objects.length) {
      data.objects.forEach(function (item, idx) {
        if (item.Name == "") index = idx;
        item.active = false;
      })
    }
    if (data.dirs.length) {
      data.dirs.forEach(function (d) {
        d.active = false;
        d.dir = true;
      })
    }
    if (index != null) data.objects.splice(index, 1);
    let Arr = data.objects.concat(data.dirs);
    let serchlist = Arr.filter((n) => {
      if (n.Name.indexOf(data.keywords) > -1) {
        return n
      }
    })
    state.filelist = serchlist;
  }
}

const actions = {
  getFileList({commit, rootGetters}, params){
    return new Promise((resolve, reject) => {
      rootGetters.userConfig.listObject(params.pms).then(function (resp) {
        if (params.pms.Page) {
          resp.keywords = params.pms.Keywords;
          commit('searchFileList', resp)
        } else {
          commit('getFileList', resp)
        }
        resolve()
      })
    })
  },
  sliceUploadFile({commit, rootGetters}, params){
    // return new Promise((resolve, reject) => {
    rootGetters.userConfig.sliceUploadFile(params.params, params.file, params.option).then(function (resp) {

    });
    // })
  },
  deleteFile({commit, rootGetters}, params){
    return new Promise((resolve, reject) => {
      rootGetters.userConfig.cos.deleteObject(params.pms, function (err, data) {
        if (!err) {
          resolve(data);
        } else {
          reject(err)
        }
      })
    })
  },
  showList({commit}, val)
  {
    commit('showList', val)
  }
  ,
  selectFile({commit}, val)
  {
    commit('selectFile', val.amount)
  }
  ,
  uploadFile(context)
  {
    console.log(context.state.selectFile)
  }
  ,
  newFolder(context)
  {
  }
  ,
  downloadFile(context)
  {
  }
}

export default {
  namespaced: true,
  state,
  mutations,
  actions
}