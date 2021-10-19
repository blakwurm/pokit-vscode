export interface CartManifest {
    author: string;
    name: string;
    defaultScene: string;
    modules: string[];
    scripts: string[];
    entities: { [name:string]: EntityStub };
    scenes: { [name:string]: SceneStub };
    sceneShards: string[];
    entityShards: string[];
  }
  
  export interface SceneStub {
    systems?: string[];
    entities: { [stub:string]: Identity[] };
    timestamp?: number;
  }
  
  export interface EntityStub {
    inherits: string[];
    components: any;
    timestamp?: number;
  }

  export interface Identity {
    id?: string;
    parent?: string;
    persistent?: boolean;
    bounds?: Vector;
    position?: Vector;
    z?: number;
    depth?: number;
    scale?: Vector;
    rotation?: number;
  }

  export interface Vector {
      x: number
      y: number
  }