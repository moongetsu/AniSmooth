import torch
import torch.nn as nn
import torch.nn.functional as F

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
tenGrid = {}
tenFlowDiv = {}

def warp(tenInput, tenFlow):
    k = (str(tenFlow.device), str(tenFlow.size()), str(tenFlow.dtype))
    if k not in tenGrid:
        H, W = tenFlow.shape[2], tenFlow.shape[3]
        tenHorizontal = (
            torch.linspace(-1.0, 1.0, W, device=tenFlow.device, dtype=torch.float32)
            .view(1, 1, 1, W)
            .expand(tenFlow.shape[0], -1, H, -1)
        )
        tenVertical = (
            torch.linspace(-1.0, 1.0, H, device=tenFlow.device, dtype=torch.float32)
            .view(1, 1, H, 1)
            .expand(tenFlow.shape[0], -1, -1, W)
        )
        tenGrid[k] = torch.cat([tenHorizontal, tenVertical], 1).to(tenFlow.dtype)
        tenFlowDiv[k] = torch.tensor(
            [2.0 / (W - 1), 2.0 / (H - 1)],
            dtype=tenFlow.dtype,
            device=tenFlow.device,
        ).view(1, 2, 1, 1)

    g = (tenGrid[k] + tenFlow * tenFlowDiv[k]).permute(0, 2, 3, 1)
    return torch.nn.functional.grid_sample(
        input=tenInput,
        grid=g,
        mode="bilinear",
        padding_mode="border",
        align_corners=True,
    )

def conv(in_planes, out_planes, kernel_size=3, stride=1, padding=1, dilation=1):
    return nn.Sequential(
        nn.Conv2d(in_planes, out_planes, kernel_size=kernel_size, stride=stride,
                  padding=padding, dilation=dilation, bias=True),
        nn.LeakyReLU(0.2, True),
    )

class Head(nn.Module):
    def __init__(self):
        super(Head, self).__init__()
        self.cnn0 = nn.Conv2d(3, 16, 3, 2, 1)
        self.cnn1 = nn.Conv2d(16, 16, 3, 1, 1)
        self.cnn2 = nn.Conv2d(16, 16, 3, 1, 1)
        self.cnn3 = nn.ConvTranspose2d(16, 4, 4, 2, 1)
        self.relu = nn.LeakyReLU(0.2, True)

    def forward(self, x, feat=False):
        x0 = self.cnn0(x)
        x = self.relu(x0)
        x1 = self.cnn1(x)
        x = self.relu(x1)
        x2 = self.cnn2(x)
        x = self.relu(x2)
        x3 = self.cnn3(x)
        if feat:
            return [x0, x1, x2, x3]
        return x3

class ResConv(nn.Module):
    def __init__(self, c, dilation=1):
        super(ResConv, self).__init__()
        self.conv = nn.Conv2d(c, c, 3, 1, dilation, dilation=dilation, groups=1)
        self.beta = nn.Parameter(torch.ones((1, c, 1, 1)), requires_grad=True)
        self.relu = nn.LeakyReLU(0.2, True)

    def forward(self, x):
        return self.relu(self.conv(x) * self.beta + x)

class IFBlock(nn.Module):
    def __init__(self, in_planes, c=64):
        super(IFBlock, self).__init__()
        self.conv0 = nn.Sequential(
            conv(in_planes, c // 2, 3, 2, 1),
            conv(c // 2, c, 3, 2, 1),
        )
        self.convblock = nn.Sequential(
            ResConv(c),
            ResConv(c),
            ResConv(c),
            ResConv(c),
            ResConv(c),
            ResConv(c),
            ResConv(c),
            ResConv(c),
        )
        self.lastconv = nn.Sequential(
            nn.ConvTranspose2d(c, 4 * 13, 4, 2, 1), nn.PixelShuffle(2)
        )

    def forward(self, x, flow=None, scale=1):
        x = F.interpolate(
            x, scale_factor=1.0 / scale, mode="bilinear", align_corners=False
        )
        if flow is not None:
            flow = (
                F.interpolate(
                    flow, scale_factor=1.0 / scale, mode="bilinear", align_corners=False
                )
                * 1.0
                / scale
            )
            x = torch.cat((x, flow), 1)
        feat = self.conv0(x)
        feat = self.convblock(feat)
        tmp = self.lastconv(feat)
        tmp = F.interpolate(
            tmp, scale_factor=scale, mode="bilinear", align_corners=False
        )
        flow = tmp[:, :4] * scale
        mask = tmp[:, 4:5]
        feat = tmp[:, 5:]
        return flow, mask, feat

class IFNet(nn.Module):
    def __init__(self, heavy=False, dynamicScale=False, scale=1):
        super(IFNet, self).__init__()
        m = 2 if heavy else 1
        self.block0 = IFBlock(7 + 8, c=192 * m)
        self.block1 = IFBlock(8 + 4 + 8 + 8, c=128 * m)
        self.block2 = IFBlock(8 + 4 + 8 + 8, c=96 * m)
        self.block3 = IFBlock(8 + 4 + 8 + 8, c=64 * m)
        self.block4 = IFBlock(8 + 4 + 8 + 8, c=32 * m)
        self.encode = Head()

        self.scale_list = [16 / scale, 8 / scale, 4 / scale, 2 / scale, 1 / scale]
        self.dynamicScale = dynamicScale
        self.blocks = [self.block0, self.block1, self.block2, self.block3, self.block4]
        self.f0 = None
        self.f1 = None

    def cacheReset(self, frame):
        self.f0 = self.encode(frame[:, :3])
        self.f1 = None

    def cachePair(self, img0, img1):
        self.f0 = self.encode(img0[:, :3])
        self.f1 = self.encode(img1[:, :3])

    def forward(self, img0, img1, timestep=0.5):
        if self.f0 is None:
            self.f0 = self.encode(img0[:, :3])
        if self.f1 is None:
            self.f1 = self.encode(img1[:, :3])

        if not isinstance(timestep, torch.Tensor):
            timestep = torch.tensor(timestep, dtype=img0.dtype, device=img0.device)
        timestep = torch.ones_like(img0[:, :1, :, :]) * timestep.view(1, 1, 1, 1)

        target_shape = img0.shape[2:]

        merged = []
        warped_img0 = img0
        warped_img1 = img1
        flow = None
        mask = None
        feat = None

        for i in range(5):
            if flow is None:
                flow, mask, feat = self.blocks[i](
                    torch.cat(
                        (img0[:, :3], img1[:, :3], self.f0, self.f1, timestep), 1
                    ),
                    None,
                    scale=self.scale_list[i],
                )
                if flow.shape[2:] != target_shape:
                    flow = F.interpolate(flow, size=target_shape, mode="bilinear",
                                         align_corners=False)
                if mask.shape[2:] != target_shape:
                    mask = F.interpolate(mask, size=target_shape, mode="bilinear",
                                         align_corners=False)
                if feat.shape[2:] != target_shape:
                    feat = F.interpolate(feat, size=target_shape, mode="bilinear",
                                         align_corners=False)
            else:
                wf0 = warp(self.f0, flow[:, :2])
                wf1 = warp(self.f1, flow[:, 2:4])
                fd, m0, feat = self.blocks[i](
                    torch.cat(
                        (
                            warped_img0[:, :3],
                            warped_img1[:, :3],
                            wf0,
                            wf1,
                            timestep,
                            mask,
                            feat,
                        ),
                        1,
                    ),
                    flow,
                    scale=self.scale_list[i],
                )
                if fd.shape[2:] != target_shape:
                    fd = F.interpolate(fd, size=target_shape, mode="bilinear",
                                       align_corners=False)
                if m0.shape[2:] != target_shape:
                    m0 = F.interpolate(m0, size=target_shape, mode="bilinear",
                                       align_corners=False)
                if feat.shape[2:] != target_shape:
                    feat = F.interpolate(feat, size=target_shape, mode="bilinear",
                                         align_corners=False)
                mask = m0
                flow = flow + fd

            warped_img0 = warp(img0, flow[:, :2])
            warped_img1 = warp(img1, flow[:, 2:4])
            merged.append((warped_img0, warped_img1))

        mask = torch.sigmoid(mask)
        result = warped_img0 * mask + warped_img1 * (1 - mask)
        self.f0 = self.f1
        return result

class RIFEModel(nn.Module):
    def __init__(self, model_version="rife4.25"):
        super(RIFEModel, self).__init__()
        self.model_version = model_version
        heavy = "heavy" in model_version
        self.flownet = IFNet(heavy=heavy)

    def cacheReset(self, frame):
        self.flownet.cacheReset(frame)

    def cachePair(self, img0, img1):
        self.flownet.cachePair(img0, img1)

    def forward(self, img0, img1, timestep=0.5):
        return self.flownet(img0, img1, timestep)
